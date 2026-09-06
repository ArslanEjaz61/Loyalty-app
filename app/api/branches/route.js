import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db.js";

export async function GET() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, city: true, address: true, hours: true },
    orderBy: [{ city: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ branches });
}
