/**
 * Who an admin screen is allowed to see.
 *
 * Company and super admins see every branch. A branch manager sees only their
 * own — and because customers are global by design, "their customers" means
 * customers who have actually transacted at that branch, not customers who
 * happen to have picked it as a home branch.
 */

import { getStaffSession, canAccessAllBranches } from "./session.js";

export async function requireAdmin() {
  const session = await getStaffSession();
  if (!session) return { error: "Please sign in.", status: 401 };
  if (session.role === "CASHIER") {
    return { error: "You do not have access to the dashboard.", status: 403 };
  }
  return { session };
}

/** Prisma `where` fragment limiting transactions to what this role may see. */
export function branchFilter(session) {
  if (canAccessAllBranches(session.role)) return {};
  return { branchId: session.branchId };
}

/** Customer ids that have transacted at this manager's branch. */
export async function scopedCustomerIds(prisma, session) {
  if (canAccessAllBranches(session.role)) return null; // null = no restriction
  const rows = await prisma.transaction.findMany({
    where: { branchId: session.branchId },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  return rows.map((r) => r.customerId);
}
