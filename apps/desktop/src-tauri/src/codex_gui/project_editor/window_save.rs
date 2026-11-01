//! Replace a single page while copying the untouched prefix/suffix with bounded memory.
use super::*;

struct Edit<'a> {
    range: &'a Request,
    text: &'a str,
    path: &'a Path,
    cancelled: &'a AtomicBool,
}

pub(in crate::codex_gui::project_editor) fn save(request: Save) -> Result<GuiResponse> {
    let range = request
        .target
        .window
        .as_ref()
        .ok_or(GuiError::InvalidRequest)?;
    let text = validate_text(&request, range)?;
    let path = resolve(&request.target)?;
    let view = view(&path, range)?;
    let mut slot = view.snapshot.lock().map_err(|_| GuiError::FileBusy)?;
    let snapshot = slot.as_mut().ok_or(GuiError::FileExpired)?;
    validate_range(snapshot, range)?;
    let _guard = locks::acquire_cancellable(&path, false, Some(&view.cancelled))?;
    if snapshot.read_only {
        return Err(GuiError::ProjectFileWrite);
    }
    if snapshot.revision != request.revision {
        return Err(GuiError::ProjectFileConflict);
    }
    let edit = Edit {
        range,
        text,
        path: &path,
        cancelled: &view.cancelled,
    };
    let staged = stage(snapshot, &edit)?;
    let replacement = capture(staged.path(), &view.cancelled)?;
    let reply = response(document(&replacement, &edit))?;
    if stream::inspect(&path)?.revision != request.revision || resolve(&request.target)? != path {
        return Err(GuiError::ProjectFileConflict);
    }
    // Cancellation precedes the atomic replacement. Once committed, the exact saved baseline is returned.
    if view.cancelled.load(Ordering::Relaxed) {
        return Err(GuiError::FileExpired);
    }
    staged
        .persist(&path)
        .map_err(|_| GuiError::ProjectFileWrite)?;
    *slot = Some(replacement);
    Ok(reply)
}

fn validate_text<'a>(request: &'a Save, range: &Request) -> Result<&'a str> {
    let text = request.text.as_deref().ok_or(GuiError::InvalidRequest)?;
    if request.upload.is_some()
        || range.cancel
        || range.open
        || text.len() > INLINE_BYTES
        || text.contains('\0')
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(text)
}

fn validate_range(snapshot: &mut Snapshot, range: &Request) -> Result<()> {
    let end = range.end.ok_or(GuiError::InvalidRequest)?;
    if range.offset > end
        || end > snapshot.size
        || end - range.offset > INLINE_BYTES as u64
        || boundary(&mut snapshot.file, range.offset, snapshot.size)? != range.offset
        || boundary(&mut snapshot.file, end, snapshot.size)? != end
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}

fn document(snapshot: &Snapshot, edit: &Edit<'_>) -> Document {
    Document {
        path: execution_path(edit.path),
        kind: "text",
        size: snapshot.size,
        text: Some(edit.text.to_owned()),
        image: None,
        revision: snapshot.revision.clone(),
        read_only: false,
        chunked: false,
        window: Some(Window {
            token: edit.range.token.clone(),
            offset: edit.range.offset,
            end: edit.range.offset + edit.text.len() as u64,
            previous: edit.range.offset.saturating_sub(PAGE_BYTES as u64 + 4),
        }),
    }
}

fn stage(snapshot: &mut Snapshot, edit: &Edit<'_>) -> Result<tempfile::NamedTempFile> {
    let mut staged =
        tempfile::NamedTempFile::new_in(edit.path.parent().ok_or(GuiError::ProjectFileWrite)?)
            .map_err(|_| GuiError::ProjectFileWrite)?;
    let end = edit.range.end.ok_or(GuiError::InvalidRequest)?;
    snapshot
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|_| GuiError::FileRead)?;
    stream::copy_range(
        &mut snapshot.file,
        &mut staged,
        edit.range.offset,
        edit.cancelled,
    )?;
    staged
        .write_all(edit.text.as_bytes())
        .map_err(|_| GuiError::ProjectFileWrite)?;
    snapshot
        .file
        .seek(SeekFrom::Start(end))
        .map_err(|_| GuiError::FileRead)?;
    stream::copy_range(
        &mut snapshot.file,
        &mut staged,
        snapshot.size - end,
        edit.cancelled,
    )?;
    let permissions = fs::metadata(edit.path)
        .map_err(|_| GuiError::FileRead)?
        .permissions();
    if permissions.readonly() {
        return Err(GuiError::ProjectFileWrite);
    }
    staged
        .as_file()
        .set_permissions(permissions)
        .and_then(|()| staged.as_file().sync_all())
        .map_err(|_| GuiError::ProjectFileWrite)?;
    Ok(staged)
}
