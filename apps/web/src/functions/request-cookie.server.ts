import { getRequestHeader } from "@tanstack/react-start/server";

export function getRequestCookie() {
	return getRequestHeader("cookie");
}
