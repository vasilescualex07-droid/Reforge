use std::path::PathBuf;

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn undo_log_path(&self) -> PathBuf {
        self.data_dir.join("undo_log.json")
    }
    pub fn snapshots_dir(&self) -> PathBuf {
        self.data_dir.join("snapshots")
    }
    pub fn wallpapers_dir(&self) -> PathBuf {
        self.data_dir.join("wallpapers")
    }
}
