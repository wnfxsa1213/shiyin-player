use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use rustplayer_core::SceneAsset;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::commands::IpcError;

pub const MAX_IMPORT_BYTES: usize = 20 * 1024 * 1024;
const MAX_PIXELS: u64 = 24_000_000;
const MAX_LIBRARY_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    id: String,
    name: String,
    width: u32,
    height: u32,
    byte_size: u64,
}

pub struct SceneAssets {
    directory: PathBuf,
    operations: Mutex<()>,
}

fn io_error(error: impl std::fmt::Display) -> IpcError {
    IpcError::Internal(format!("background storage: {error}"))
}

fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl SceneAssets {
    pub fn new(app_data: &Path) -> Self {
        Self {
            directory: app_data.join("scene-assets"),
            operations: Mutex::new(()),
        }
    }

    fn public(&self, metadata: Metadata) -> SceneAsset {
        SceneAsset {
            display_path: format!("{}.webp", metadata.id),
            thumbnail_path: format!("{}-thumb.webp", metadata.id),
            id: metadata.id,
            name: metadata.name,
            width: metadata.width,
            height: metadata.height,
            byte_size: metadata.byte_size,
        }
    }

    pub fn list(&self) -> Result<Vec<SceneAsset>, IpcError> {
        let _guard = self.operations.lock().map_err(io_error)?;
        if !self.directory.exists() {
            return Ok(Vec::new());
        }
        let mut assets = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if fs::metadata(&path)
                .map(|metadata| metadata.len() > 4096)
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Ok(metadata) = serde_json::from_slice::<Metadata>(&bytes) else {
                continue;
            };
            if valid_id(&metadata.id)
                && path.file_stem().and_then(|value| value.to_str()) == Some(metadata.id.as_str())
            {
                assets.push(self.public(metadata));
            }
        }
        assets.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(assets)
    }

    pub fn import(&self, bytes: &[u8], name: &str) -> Result<SceneAsset, IpcError> {
        if bytes.is_empty() || bytes.len() > MAX_IMPORT_BYTES {
            return Err(IpcError::InvalidInput("请选择 20 MB 以内的图片".into()));
        }
        let _guard = self.operations.lock().map_err(io_error)?;
        fs::create_dir_all(&self.directory).map_err(io_error)?;
        let id = format!("{:x}", Sha256::digest(bytes));
        let metadata_path = self.directory.join(format!("{id}.json"));
        if self.directory.join(format!("{id}.webp")).exists()
            && self.directory.join(format!("{id}-thumb.webp")).exists()
            && self.directory.join(format!("{id}-source")).exists()
        {
            if let Ok(data) = fs::read(&metadata_path) {
                if let Ok(metadata) = serde_json::from_slice::<Metadata>(&data) {
                    if metadata.id == id {
                        return Ok(self.public(metadata));
                    }
                }
            }
        }
        let reader = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(io_error)?;
        let format = reader
            .format()
            .ok_or_else(|| IpcError::InvalidInput("无法识别图片格式".into()))?;
        if !matches!(
            format,
            ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
        ) {
            return Err(IpcError::InvalidInput(
                "请选择 JPEG、PNG 或 WebP 图片".into(),
            ));
        }
        let (width, height) = reader
            .into_dimensions()
            .map_err(|_| IpcError::InvalidInput("图片数据损坏".into()))?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            return Err(IpcError::InvalidInput(
                "图片像素过大，请选择 2400 万像素以内的图片".into(),
            ));
        }
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = Limits::default();
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let mut decoder = reader
            .into_decoder()
            .map_err(|_| IpcError::InvalidInput("无法解码图片".into()))?;
        let orientation = decoder
            .orientation()
            .unwrap_or(image::metadata::Orientation::NoTransforms);
        let mut decoded = DynamicImage::from_decoder(decoder)
            .map_err(|_| IpcError::InvalidInput("无法解码图片".into()))?;
        decoded.apply_orientation(orientation);
        let display = if decoded.width() > 2560 || decoded.height() > 2560 {
            decoded.resize(2560, 2560, image::imageops::FilterType::Triangle)
        } else {
            decoded
        };
        let thumbnail = if display.width() > 320 || display.height() > 320 {
            display.thumbnail(320, 320)
        } else {
            display.clone()
        };
        let encode = |image: &DynamicImage| -> Result<Vec<u8>, IpcError> {
            let mut data = Cursor::new(Vec::new());
            image
                .write_to(&mut data, ImageFormat::WebP)
                .map_err(io_error)?;
            Ok(data.into_inner())
        };
        let display_bytes = encode(&display)?;
        let thumbnail_bytes = encode(&thumbnail)?;
        let occupied = fs::read_dir(&self.directory)
            .map_err(io_error)?
            .try_fold(0_u64, |total, entry| {
                entry
                    .and_then(|entry| entry.metadata())
                    .map(|metadata| total.saturating_add(metadata.len()))
            })
            .map_err(io_error)?;
        let required = (bytes.len() + display_bytes.len() + thumbnail_bytes.len()) as u64;
        let replaced: u64 = ["-source", ".webp", "-thumb.webp", ".json"]
            .iter()
            .filter_map(|suffix| fs::metadata(self.directory.join(format!("{id}{suffix}"))).ok())
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len())
            .sum();
        if occupied
            .saturating_sub(replaced)
            .saturating_add(required)
            .saturating_add(4096)
            > MAX_LIBRARY_BYTES
        {
            return Err(IpcError::InvalidInput(
                "背景素材已达 512 MB，请先删除未使用的背景".into(),
            ));
        }
        let metadata = Metadata {
            id: id.clone(),
            name: name
                .chars()
                .filter(|character| !character.is_control())
                .take(120)
                .collect(),
            width: display.width(),
            height: display.height(),
            byte_size: required,
        };
        let metadata_bytes = serde_json::to_vec(&metadata).map_err(io_error)?;
        let files: [(String, &[u8]); 4] = [
            (format!("{id}-source"), bytes),
            (format!("{id}.webp"), &display_bytes),
            (format!("{id}-thumb.webp"), &thumbnail_bytes),
            (format!("{id}.json"), &metadata_bytes),
        ];
        let had_metadata = metadata_path.exists();
        let result = (|| {
            // Prepare every file before publishing metadata, so failed imports are never listed.
            for (name, bytes) in &files {
                fs::write(self.directory.join(format!("{name}.pending")), bytes)
                    .map_err(io_error)?;
            }
            for (name, _) in &files {
                fs::rename(
                    self.directory.join(format!("{name}.pending")),
                    self.directory.join(name),
                )
                .map_err(io_error)?;
            }
            Ok::<(), IpcError>(())
        })();
        if result.is_err() {
            for (name, _) in &files {
                let _ = fs::remove_file(self.directory.join(format!("{name}.pending")));
                if !had_metadata {
                    let _ = fs::remove_file(self.directory.join(name));
                }
            }
        }
        result?;
        Ok(self.public(metadata))
    }

    pub fn delete(&self, id: &str) -> Result<(), IpcError> {
        if !valid_id(id) {
            return Err(IpcError::InvalidInput("无效的背景标识".into()));
        }
        let _guard = self.operations.lock().map_err(io_error)?;
        for suffix in [".webp", "-thumb.webp", "-source", ".json"] {
            if let Err(error) = fs::remove_file(self.directory.join(format!("{id}{suffix}"))) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(io_error(error));
                }
            }
        }
        Ok(())
    }

    pub fn read_image(&self, filename: &str) -> Result<Vec<u8>, IpcError> {
        filename
            .strip_suffix("-thumb.webp")
            .or_else(|| filename.strip_suffix(".webp"))
            .filter(|id| valid_id(id))
            .ok_or_else(|| IpcError::InvalidInput("无效的背景资源".into()))?;
        let path = self.directory.join(filename);
        if fs::metadata(&path).map_err(io_error)?.len() > 32 * 1024 * 1024 {
            return Err(IpcError::InvalidInput("背景资源过大".into()));
        }
        fs::read(path).map_err(io_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                    "shiyin-assets-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                )))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn imports_deduplicates_lists_and_deletes_only_managed_assets() {
        let fixture = Fixture::new();
        let storage = SceneAssets::new(&fixture.0);
        let image = DynamicImage::new_rgba8(64, 48);
        let mut data = Cursor::new(Vec::new());
        image.write_to(&mut data, ImageFormat::Png).unwrap();
        let asset = storage.import(data.get_ref(), "背景.png").unwrap();
        assert!(storage.directory.join(&asset.display_path).exists());
        assert!(storage.directory.join(&asset.thumbnail_path).exists());
        assert!(storage.read_image(&asset.thumbnail_path).is_ok());
        assert_eq!((asset.width, asset.height), (64, 48));
        let thumb =
            image::load_from_memory(&storage.read_image(&asset.thumbnail_path).unwrap()).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (64, 48));
        assert!(storage.read_image("../unrelated").is_err());
        assert_eq!(
            storage.import(data.get_ref(), "duplicate.png").unwrap().id,
            asset.id
        );
        assert_eq!(storage.list().unwrap().len(), 1);
        assert_eq!(storage.list().unwrap()[0].name, "背景.png");
        fs::write(fixture.0.join("unrelated"), b"preserve").unwrap();
        assert!(storage.delete("../unrelated").is_err());
        storage.delete(&asset.id).unwrap();
        assert!(storage.list().unwrap().is_empty());
        assert_eq!(fs::read(fixture.0.join("unrelated")).unwrap(), b"preserve");
    }

    #[test]
    fn rejects_invalid_and_excessively_large_images_before_storage() {
        let fixture = Fixture::new();
        let storage = SceneAssets::new(&fixture.0);
        assert!(storage.import(b"not an image", "photo.png").is_err());
        assert!(storage
            .import(&vec![0; MAX_IMPORT_BYTES + 1], "photo.png")
            .is_err());
        assert!(storage.list().unwrap().is_empty());
    }

    #[test]
    fn failed_import_cleans_partial_files_and_can_be_retried() {
        let fixture = Fixture::new();
        let storage = SceneAssets::new(&fixture.0);
        let mut data = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(32, 32)
            .write_to(&mut data, ImageFormat::Png)
            .unwrap();
        let id = format!("{:x}", Sha256::digest(data.get_ref()));
        let blocker = storage.directory.join(format!("{id}.webp.pending"));
        fs::create_dir_all(&blocker).unwrap();
        assert!(storage.import(data.get_ref(), "failed.png").is_err());
        assert!(!storage.directory.join(format!("{id}-source")).exists());
        assert!(!storage
            .directory
            .join(format!("{id}-source.pending"))
            .exists());
        assert!(storage.list().unwrap().is_empty());
        fs::remove_dir(blocker).unwrap();
        assert!(storage.import(data.get_ref(), "retry.png").is_ok());
        assert_eq!(storage.list().unwrap().len(), 1);
    }

    #[test]
    fn display_and_thumbnail_have_bounded_dimensions_and_survive_original_removal() {
        let fixture = Fixture::new();
        let storage = SceneAssets::new(&fixture.0);
        let mut data = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3000, 1000)
            .write_to(&mut data, ImageFormat::Jpeg)
            .unwrap();
        let original = fixture.0.with_extension("jpg");
        fs::write(&original, data.get_ref()).unwrap();
        let asset = storage
            .import(&fs::read(&original).unwrap(), "landscape.jpg")
            .unwrap();
        fs::remove_file(original).unwrap();
        assert_eq!(asset.width, 2560);
        assert!(asset.height <= 854);
        let thumbnail =
            image::load_from_memory(&storage.read_image(&asset.thumbnail_path).unwrap()).unwrap();
        assert_eq!(thumbnail.width(), 320);
        assert!(thumbnail.height() <= 107);
        assert!(storage.read_image(&asset.display_path).is_ok());
    }
}
