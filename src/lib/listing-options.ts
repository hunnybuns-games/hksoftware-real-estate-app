import { db } from "@/lib/db";
import { centsToInputValue } from "@/lib/money";

export type ListingUnitOption = {
  id: string;
  label: string;
  propertyName: string;
  status: "VACANT" | "OCCUPIED" | "MAINTENANCE";
  marketRent: string;
};

/** Every unit in the org, for the "which unit is this listing for" picker on /app/listings/new. */
export async function getListingUnitOptions(organizationId: string): Promise<ListingUnitOption[]> {
  const units = await db.unit.findMany({
    where: { property: { organizationId } },
    orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
    select: {
      id: true,
      label: true,
      status: true,
      marketRentCents: true,
      property: { select: { name: true } },
    },
  });

  return units.map((u) => ({
    id: u.id,
    label: u.label,
    propertyName: u.property.name,
    status: u.status,
    marketRent: centsToInputValue(u.marketRentCents),
  }));
}
