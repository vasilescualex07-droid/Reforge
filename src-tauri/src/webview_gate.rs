//! WebView2 window-creation gate (boot deadlock fix).
//!
//! Windows WebView2 cannot create a second controller on the same thread
//! while a first creation is still blocked waiting for its async completion
//! callback. Wry blocks that wait in a nested message pump
//! (`webview2_com::wait_with_pump`), and during boot the pump dispatches
//! queued startup work — the deferred restore's wallpaper/splash windows and
//! the frontend's overlay spawns land in the same window — so a second
//! `WebviewWindowBuilder::build()` re-enters WebView2's serialized
//! initialization and deadlocks the main thread permanently (the "widgets
//! freeze the app" bug: wallpaper engine on + a persistent overlay at boot).
//!
//! `gate::run` marks the current thread as "creating a window" for the
//! duration of a creation. A nested `gate::run` on the same thread (only
//! possible from inside the nested pump) queues the closure instead of
//! creating inline; the outermost creation drains the queue right after it
//! completes, so every window still opens — just sequentially instead of
//! nested. Callers that need the created value back get `None` when queued
//! (the work still runs; the window appears a moment later).
use std::cell::Cell;
use std::collections::VecDeque;
use std::sync::Mutex;

thread_local! {
    static IN_CREATION: Cell<bool> = const { Cell::new(false) };
}
static QUEUE: Mutex<VecDeque<Box<dyn FnOnce() + Send>>> = Mutex::new(VecDeque::new());

/// Run a window-creation closure, serialized against other creations on this
/// thread. Returns `Some(value)` when the closure ran inline (the normal
/// case) or `None` when it was queued behind an in-flight creation — the
/// queued work runs right after the current creation finishes, so callers
/// that only need "accepted" semantics can treat `None` as success.
pub fn run<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    if IN_CREATION.with(|c| c.get()) {
        QUEUE
            .lock()
            .unwrap()
            .push_back(Box::new(move || {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
            }));
        return None;
    }
    let out = run_inner(f);
    drain();
    out
}

/// Execute one creation with the thread-local flag set. A panic inside the
/// creation still clears the flag (the guard in the callee), so the gate can
/// never wedge the queue.
fn run_inner<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    struct Flag;
    impl Drop for Flag {
        fn drop(&mut self) {
            IN_CREATION.with(|c| c.set(false));
        }
    }
    let _flag = Flag; // resets IN_CREATION even on panic
    IN_CREATION.with(|c| c.set(true));
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok()
}

/// Run everything that nested creations queued while the outer creation was
/// in flight. Each queued item runs with the flag set (its own nested-pump
/// requests queue again and are picked up by this loop), preserving FIFO
/// order.
fn drain() {
    loop {
        let next = QUEUE.lock().unwrap().pop_front();
        match next {
            Some(item) => {
                let _ = run_inner(item);
            }
            None => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inline_run_returns_value() {
        assert_eq!(run(|| 42), Some(42));
    }

    #[test]
    fn nested_run_queues_and_drains_in_order() {
        let order = std::sync::Arc::new(Mutex::new(Vec::new()));
        let o1 = order.clone();
        let o2 = order.clone();
        let o3 = order.clone();
        // The outer closure runs inline; the inner `run` calls see the flag
        // set and queue instead of creating inline.
        let outer = run(move || {
            o1.lock().unwrap().push("outer");
            assert_eq!(run(move || o2.lock().unwrap().push("inner1")), None);
            assert_eq!(run(move || o3.lock().unwrap().push("inner2")), None);
            "done"
        });
        assert_eq!(outer, Some("done"));
        // The queue is drained by the outermost run — in FIFO order.
        assert_eq!(
            *order.lock().unwrap(),
            vec!["outer", "inner1", "inner2"]
        );
    }

    #[test]
    fn queue_preserves_fifo_across_a_second_inline_run() {
        let order = std::sync::Arc::new(Mutex::new(Vec::new()));
        let o1 = order.clone();
        let o2 = order.clone();
        let o3 = order.clone();
        run(move || {
            o1.lock().unwrap().push("a");
            let _ = run(move || o2.lock().unwrap().push("b")); // queued
            let _ = run(move || o3.lock().unwrap().push("c")); // queued behind b
        });
        // After the outer creation completes, a fresh top-level run must not
        // be queued behind leftovers — the drain already emptied the queue.
        assert_eq!(run(|| 7), Some(7));
        assert_eq!(*order.lock().unwrap(), vec!["a", "b", "c"]);
    }

    #[test]
    fn panic_inside_creation_does_not_wedge_the_gate() {
        let _ = run::<()>(|| panic!("boom"));
        // The flag was reset — a following run executes inline.
        assert_eq!(run(|| 5), Some(5));
    }
}
