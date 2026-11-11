use super::*;

pub(super) async fn open<R: Runtime>(app: &AppHandle<R>, args: protocol::Open) -> Result<Value> {
    let registry = registry(app);
    let permit = registry
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| csw_ssh_client::Error::Limit)?;
    let entry = create(app, args, permit).await?;
    let id = format!("agent-{}", uuid::Uuid::new_v4());
    registry
        .entries
        .lock()
        .await
        .insert(id.clone(), entry.clone());
    lifecycle::watch(app.clone(), id.clone(), Arc::downgrade(&entry));
    authorize(app, &id, &entry).await?;
    let output = entry.buffer.read(&id, 0, 1000).await?;
    authorize(app, &id, &entry).await?;
    serde_json::to_value(output).map_err(|_| ProfileError::Unavailable.into())
}

async fn create<R: Runtime>(
    app: &AppHandle<R>,
    args: protocol::Open,
    permit: OwnedSemaphorePermit,
) -> Result<Arc<Terminal>> {
    let (owner, mut request) = prepare(
        app,
        Target {
            id: args.profile_id,
            revision: args.revision,
        },
    )
    .await?;
    request.size = args.size;
    let password = Zeroizing::new(request.password.clone());
    let buffer = Arc::new(Buffer::default());
    if let Some(password) = password.as_deref().filter(|password| !password.is_empty()) {
        buffer.protect(password.as_bytes())?;
    }
    let sink = buffer.clone();
    let client = app.state::<Arc<Client>>().inner().clone();
    let info = client
        .open_pty(
            request,
            args.command,
            Arc::new(move |event| sink.event(event)),
        )
        .await?;
    Ok(Arc::new(Terminal {
        thread_id: args.thread_id,
        owner,
        remote_id: info.id,
        buffer,
        password,
        input: Mutex::new(()),
        _permit: permit,
    }))
}
