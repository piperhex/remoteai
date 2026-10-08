/** A full bounded queue may retry later without invalidating the connection's health. */
export class ChannelBackpressureError extends Error {
  constructor() { super('Channel send buffer is full'); this.name = 'ChannelBackpressureError'; }
}
