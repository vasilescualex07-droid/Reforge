use std::process::Command;

/// Create a Command pre-configured to run without showing a console window on Windows.
/// On non-Windows platforms, this is just a plain Command::new.
pub fn hidden(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
