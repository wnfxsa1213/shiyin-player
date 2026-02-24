use std::sync::Arc;
use rustplayer_core::{MusicSource, MusicSourceId};

pub struct SourceRegistry {
    sources: Vec<Arc<dyn MusicSource>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self { sources: Vec::new() }
    }

    pub fn register(&mut self, source: Arc<dyn MusicSource>) {
        self.sources.push(source);
    }

    pub fn get(&self, id: MusicSourceId) -> Option<&Arc<dyn MusicSource>> {
        self.sources.iter().find(|s| s.id() == id)
    }

    pub fn all(&self) -> &[Arc<dyn MusicSource>] {
        &self.sources
    }
}
