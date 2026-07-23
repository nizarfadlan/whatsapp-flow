import { createContext, useContext } from "react";

export type ActiveOrganization = {
	id: string;
	slug: string;
	name: string;
};

const ActiveOrganizationContext = createContext<ActiveOrganization | null>(
	null,
);

export function ActiveOrganizationProvider({
	organization,
	children,
}: {
	organization: ActiveOrganization;
	children: React.ReactNode;
}) {
	return (
		<ActiveOrganizationContext.Provider value={organization}>
			{children}
		</ActiveOrganizationContext.Provider>
	);
}

export function useActiveOrganization() {
	const organization = useContext(ActiveOrganizationContext);
	if (!organization) {
		throw new Error(
			"useActiveOrganization must be used within an ActiveOrganizationProvider",
		);
	}
	return organization;
}
