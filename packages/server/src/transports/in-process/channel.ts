import type { ByteConnection } from "../../connection.ts";

/**
 * A single endpoint of an in-process paired channel.
 *
 * Two endpoints are created together and wired to each other.
 * Each side can be used as a ByteConnection (server side)
 * or wrapped into a ByteTransport (client side).
 * Data written to one endpoint is delivered synchronously
 * to the other endpoint's onData handler.
 */
export class InProcessEndpoint implements ByteConnection {
	private peer: InProcessEndpoint | null = null;
	private closedValue = false;
	private onDataHandler: ((chunk: Uint8Array) => void) | null = null;
	private onCloseHandler: (() => void) | null = null;
	private onErrorHandler: ((error: Error) => void) | null = null;

	get closed(): boolean {
		return this.closedValue;
	}

	/** Wire this endpoint to its peer so data flows bidirectionally. */
	connect(peer: InProcessEndpoint): void {
		this.peer = peer;
	}

	/** Register delivery handlers invoked by the peer endpoint. */
	setHandlers(
		onData: (chunk: Uint8Array) => void,
		onClose: () => void,
		onError: (error: Error) => void,
	): void {
		this.onDataHandler = onData;
		this.onCloseHandler = onClose;
		this.onErrorHandler = onError;
	}

	/** ByteConnection.send — delivers chunk to peer's onData synchronously. */
	send(chunk: Uint8Array): Promise<void> {
		if (this.closedValue) {
			return Promise.reject(new Error("In-process connection is closed"));
		}
		const target = this.peer;
		if (!target || target.closedValue) {
			return Promise.reject(new Error("In-process peer is closed"));
		}
		try {
			// Clone so receiver owns its own buffer independent of sender.
			target.deliver(chunk.slice());
		} catch (error) {
			target.reportError(error instanceof Error ? error : new Error(String(error)));
		}
		return Promise.resolve();
	}

	/** ByteConnection.close — marks both ends closed and signals peer. */
	close(): void {
		if (this.closedValue) return;
		this.closedValue = true;
		const target = this.peer;
		if (target && !target.closedValue) {
			target.closedValue = true;
			try {
				target.onCloseHandler?.();
			} catch {
				// Peer is already shutting down.
			}
		}
	}

	/** Called by the paired endpoint to deliver a chunk. */
	private deliver(chunk: Uint8Array): void {
		if (this.closedValue) return;
		try {
			this.onDataHandler?.(chunk);
		} catch (error) {
			this.reportError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private reportError(error: Error): void {
		try {
			this.onErrorHandler?.(error);
		} catch {
			// Error observers cannot affect connection state.
		}
	}
}

/** Creates a matched pair of connected endpoints. */
export function createChannelPair(): [InProcessEndpoint, InProcessEndpoint] {
	const server = new InProcessEndpoint();
	const client = new InProcessEndpoint();
	server.connect(client);
	client.connect(server);
	return [server, client];
}
