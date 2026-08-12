import type { ByteConnectionAcceptor } from "../../connection.ts";
import type { PiServerListener } from "../../listener.ts";
import { createChannelPair, InProcessEndpoint } from "./channel.ts";

/** Mirrors @earendil-works/pi-client ByteTransport without a cross-package dependency. */
export interface InProcessByteTransport {
	send(chunk: Uint8Array): Promise<void>;
	close(): void;
}

/** Handlers delivered to a ByteTransportFactory. */
export interface InProcessByteTransportHandlers {
	onData(chunk: Uint8Array): void;
	onClose(): void;
	onError(error: Error): void;
}

/** A factory that creates a ByteTransport wired through an in-process channel. */
export type InProcessByteTransportFactory = (
	handlers: InProcessByteTransportHandlers,
) => InProcessByteTransport | Promise<InProcessByteTransport>;

/**
 * A PiServerListener that accepts connections through in-process
 * paired byte channels instead of a network transport.
 *
 * Used when PiServer and PiClient run in the same Node.js process
 * (e.g. an Electron main process). No serialization overhead beyond
 * the mandatory CBOR encode/decode — data is delivered via direct
 * synchronous function calls.
 */
export class InProcessListener implements PiServerListener {
	private acceptHandler: ByteConnectionAcceptor | null = null;
	private activeEndpoints = new Set<InProcessEndpoint>();
	private closing = false;
	private closePromise: Promise<void> | undefined;

	get address(): string | undefined {
		return "in-process";
	}

	async start(accept: ByteConnectionAcceptor): Promise<void> {
		if (this.acceptHandler) throw new Error("In-process listener is already started");
		if (this.closing) throw new Error("In-process listener is closing or closed");
		this.acceptHandler = accept;
	}

	async close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closing = true;
		this.acceptHandler = null;
		this.closePromise = (async () => {
			const endpoints = [...this.activeEndpoints];
			this.activeEndpoints.clear();
			for (const endpoint of endpoints) {
				try {
					endpoint.close();
				} catch {
					// Best-effort.
				}
			}
		})();
		return this.closePromise;
	}

	/**
	 * Creates a new paired channel and returns a ByteTransportFactory
	 * that the client can use to connect. The server-side endpoint is
	 * accepted by this listener.
	 */
	createTransportFactory(): InProcessByteTransportFactory {
		if (!this.acceptHandler) {
			throw new Error("In-process listener is not started");
		}

		const [serverEndpoint, clientEndpoint] = createChannelPair();
		this.activeEndpoints.add(serverEndpoint);
		this.activeEndpoints.add(clientEndpoint);

		// Accept the server side through the listener's acceptor.
		const handler = this.acceptHandler(serverEndpoint);
		serverEndpoint.setHandlers(
			(chunk) => handler.onData(chunk),
			() => {
				this.activeEndpoints.delete(serverEndpoint);
				handler.onClose();
			},
			(error) => handler.onError(error),
		);

		// Return a factory that wires up the client side.
		return (transportHandlers) => {
			clientEndpoint.setHandlers(
				(chunk) => transportHandlers.onData(chunk),
				() => {
					this.activeEndpoints.delete(clientEndpoint);
					transportHandlers.onClose();
				},
				(error) => transportHandlers.onError(error),
			);

			const transport: InProcessByteTransport = {
				send: (chunk: Uint8Array) => clientEndpoint.send(chunk),
				close: () => {
					clientEndpoint.close();
				},
			};

			return transport;
		};
	}
}

/** Convenience: creates and starts the listener, returning it and the factory. */
export function createInProcessListener(): {
	listener: InProcessListener;
	createTransportFactory: () => InProcessByteTransportFactory;
} {
	const listener = new InProcessListener();
	return {
		listener,
		createTransportFactory: () => listener.createTransportFactory(),
	};
}
