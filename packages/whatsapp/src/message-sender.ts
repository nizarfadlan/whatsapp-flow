import type { WAMessageKey, WASocket } from "baileys";

export type OutgoingMessage =
	| { type: "text"; text: string }
	| { type: "image"; url: string; caption?: string }
	| { type: "video"; url: string; caption?: string }
	| { type: "audio"; url: string; ptt?: boolean }
	| { type: "document"; url: string; fileName: string; mimetype?: string }
	| { type: "location"; latitude: number; longitude: number; name?: string }
	| { type: "reaction"; text: string; messageKey: WAMessageKey };

export async function sendWhatsAppMessage(
	socket: WASocket,
	jid: string,
	message: OutgoingMessage,
) {
	switch (message.type) {
		case "text":
			return socket.sendMessage(jid, { text: message.text });
		case "image":
			return socket.sendMessage(jid, {
				image: { url: message.url },
				caption: message.caption,
			});
		case "video":
			return socket.sendMessage(jid, {
				video: { url: message.url },
				caption: message.caption,
			});
		case "audio":
			return socket.sendMessage(jid, {
				audio: { url: message.url },
				ptt: message.ptt,
			});
		case "document":
			return socket.sendMessage(jid, {
				document: { url: message.url },
				fileName: message.fileName,
				mimetype: message.mimetype ?? "application/octet-stream",
			});
		case "location":
			return socket.sendMessage(jid, {
				location: {
					degreesLatitude: message.latitude,
					degreesLongitude: message.longitude,
					name: message.name,
				},
			});
		case "reaction":
			return socket.sendMessage(jid, {
				react: {
					text: message.text,
					key: message.messageKey,
				},
			});
	}
}
