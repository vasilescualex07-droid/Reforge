fn main() {
    tauri_build::build();
    // S1.2 — bake build identity into the binary so Settings → About and the
    // shell banner can flag a stale exe. The release script supplies
    // REFORGE_BUILD_TS / REFORGE_GIT_HASH explicitly; gating on those env vars
    // (rather than the wall clock) means plain dev builds don't recompile the
    // app crate on every build — a fresh timestamp each run would defeat
    // cargo's fingerprinting. When the env vars are unset (dev builds) the
    // values are simply absent and About shows a "dev build" marker instead of
    // a misleading date.
    println!("cargo:rerun-if-env-changed=REFORGE_BUILD_TS");
    if let Ok(ts) = std::env::var("REFORGE_BUILD_TS") {
        println!("cargo:rustc-env=REFORGE_BUILD_TS={}", ts);
    }
    println!("cargo:rerun-if-env-changed=REFORGE_GIT_HASH");
    if let Ok(hash) = std::env::var("REFORGE_GIT_HASH") {
        println!("cargo:rustc-env=REFORGE_GIT_HASH={}", hash);
    } else if let Ok(out) = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
    {
        if out.status.success() {
            let hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
            println!("cargo:rustc-env=REFORGE_GIT_HASH={}", hash);
        }
    }
    // Exe command-table mystery (resolved Aug 13) — MSVC's linker defaults to
    // /OPT:REF (drop unreferenced sections). In release builds it drops the
    // dispatch code for zero-argument Tauri commands: the command-name string
    // for a no-arg command exists ONLY in the generate_handler match arm (the
    // nested per-arm closures under `run::{closure#..}`), so the linker treats
    // those sections as unreferenced and removes them from the exe — 40 of 56
    // no-arg commands vanished (all 151 commands with arguments survived,
    // because their name string also appears in the CommandArg::from_command
    // call inside the arm). Debug builds keep all 207; release + /OPT:NOREF
    // keeps all 207 (verified: diag16.py reports 207/207). /OPT:ICF is NOT the
    // cause (release + /OPT:NOICF alone still drops the 40).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        // Scope to the release BIN only. Applied to debug-profile links (dev
        // exe, `cargo test` harnesses) the flag breaks them at load time with
        // 0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND (observed Aug 13 — without
        // the flag the debug test binary runs all 41 tests fine).
        println!("cargo:rustc-link-arg-bin=reforge=/OPT:NOREF");
    }

    // S14 — no manifest fix here: tauri's default `common-controls-v6` feature
    // (which pulls comctl32 TaskDialogIndirect into every binary, including
    // manifest-less cargo test harnesses that then die at load with 0xc0000139)
    // is disabled in Cargo.toml instead. See Cargo.toml for the rationale.
}
