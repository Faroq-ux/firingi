/**
 * Fleet — vehicles and drivers of the company that delivers:
 *   • vendors (distributors / wholesalers) for their free deliveries (VENDOR_FLEET),
 *   • FIRINGI for FIRINGI_FLEET deliveries.
 * Vendor drivers and vehicles are active as soon as the vendor adds them (the vendor is
 * responsible for them); FIRINGI can suspend any driver or vehicle. Independent drivers who
 * apply through registration still need FIRINGI's document review (drivers.ts).
 */
import type { DriverAvailability, Prisma, VehicleStatus } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";

const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
const isAdmin = (ctx: Ctx) => ctx.company.type === "ADMIN";

function requireView(ctx: Ctx) {
  if (isVendor(ctx) && can(ctx, ["vendor.fleet.view", "vendor.drivers.manage", "vendor.vehicles.manage", "vendor.orders.manage"])) return;
  if (isAdmin(ctx) && can(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view", "admin.delivery.manage"])) return;
  throw new ForbiddenError();
}
function requireManage(ctx: Ctx, what: "drivers" | "vehicles") {
  if (isVendor(ctx) && can(ctx, what === "drivers" ? "vendor.drivers.manage" : "vendor.vehicles.manage")) return;
  if (isAdmin(ctx) && can(ctx, "admin.fleet.manage")) return;
  throw new ForbiddenError();
}

const driverSelect = {
  id: true, status: true, availability: true, licenceNumber: true, licenceExpiry: true, ownerCompanyId: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
  owner: { select: { id: true, legalName: true, tradeName: true, type: true } },
  _count: { select: { deliveries: { where: { status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] } } } } },
} satisfies Prisma.DriverSelect;

const vehicleSelect = {
  id: true, plate: true, type: true, make: true, model: true, capacityKg: true, capacityM3: true, isRefrigerated: true, status: true, ownerCompanyId: true, createdAt: true,
  owner: { select: { id: true, legalName: true, tradeName: true, type: true } },
} satisfies Prisma.VehicleSelect;

/** The caller's own fleet (vendor's, or FIRINGI's for admin users). */
export async function ownFleet(ctx: Ctx) {
  requireView(ctx);
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { ownerCompanyId: ctx.company.id }, select: driverSelect, orderBy: { user: { name: "asc" } } }),
    prisma.vehicle.findMany({ where: { ownerCompanyId: ctx.company.id }, select: vehicleSelect, orderBy: { plate: "asc" } }),
  ]);
  return { drivers, vehicles };
}

/** FIRINGI view of every fleet (optionally only vendors' or only FIRINGI's). */
export async function allFleets(ctx: Ctx, f: { owner?: "FIRINGI" | "VENDORS"; availability?: DriverAvailability; pendingVehicles?: boolean } = {}) {
  if (!isAdmin(ctx)) throw new ForbiddenError();
  requireView(ctx);
  const ownerWhere = f.owner === "FIRINGI" ? { owner: { type: "ADMIN" as const } } : f.owner === "VENDORS" ? { owner: { type: { not: "ADMIN" as const } } } : {};
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { ...ownerWhere, ...(f.availability ? { availability: f.availability, status: "APPROVED" } : {}) }, select: driverSelect, orderBy: [{ owner: { legalName: "asc" } }, { user: { name: "asc" } }] }),
    prisma.vehicle.findMany({ where: { ...ownerWhere, ...(f.pendingVehicles ? { status: "PENDING_APPROVAL" } : {}) }, select: vehicleSelect, orderBy: [{ owner: { legalName: "asc" } }, { plate: "asc" }] }),
  ]);
  return { drivers, vehicles };
}

// ── vehicles ────────────────────────────────────────────────────────────────

export type VehicleInput = { plate: string; type: string; make?: string | null; model?: string | null; capacityKg?: number | string | null; capacityM3?: number | string | null; isRefrigerated?: boolean };

const optNum = (v: number | string | null | undefined, label: string) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new ValidationError(`${label} must be a positive number.`);
  return n.toFixed(2);
};
export const VEHICLE_TYPES = ["VAN", "REFRIGERATED_VAN", "TRUCK", "REFRIGERATED_TRUCK", "CAR", "MOTORBIKE", "OTHER"] as const;

export async function addVehicle(ctx: Ctx, input: VehicleInput) {
  requireManage(ctx, "vehicles");
  const plate = input.plate.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(plate)) throw new ValidationError("Enter a valid licence plate.");
  if (!(VEHICLE_TYPES as readonly string[]).includes(input.type)) throw new ValidationError("Choose a vehicle type.");
  if (await prisma.vehicle.findUnique({ where: { ownerCompanyId_plate: { ownerCompanyId: ctx.company.id, plate } } }))
    throw new AppError("PLATE_TAKEN", "You already have a vehicle with this plate.", 409);
  return prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.create({
      data: {
        ownerCompanyId: ctx.company.id, plate, type: input.type, make: input.make?.trim() || null, model: input.model?.trim() || null,
        capacityKg: optNum(input.capacityKg, "Capacity (kg)"), capacityM3: optNum(input.capacityM3, "Capacity (m³)"),
        isRefrigerated: !!input.isRefrigerated || input.type.startsWith("REFRIGERATED"), status: "ACTIVE",
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vehicle.added", entityType: "Vehicle", entityId: v.id, after: { plate, type: input.type } }, tx);
    return v;
  });
}

/**
 * Owner: ACTIVE ↔ MAINTENANCE ↔ INACTIVE. FIRINGI (fleet.manage) may set any vehicle's
 * status — e.g. take a vendor vehicle off the road (INACTIVE) — and approve pending ones.
 */
export async function setVehicleStatus(ctx: Ctx, id: string, status: VehicleStatus, reason?: string | null) {
  const v = await prisma.vehicle.findUnique({ where: { id } });
  if (!v) throw new NotFoundError("Vehicle");
  const own = v.ownerCompanyId === ctx.company.id;
  if (own) requireManage(ctx, "vehicles");
  else if (!(isAdmin(ctx) && can(ctx, "admin.fleet.manage"))) throw new NotFoundError("Vehicle");
  if (status === "PENDING_APPROVAL") throw new ValidationError("Not a valid status.");
  if (!own && status !== "INACTIVE" && status !== "ACTIVE") throw new ValidationError("FIRINGI can activate or deactivate a vendor's vehicle.");
  if (!own && !reason?.trim() && status === "INACTIVE") throw new ValidationError("Please give a reason.");
  if (status !== "ACTIVE") {
    const busy = await prisma.delivery.count({ where: { vehicleId: id, status: { in: ["PICKED_UP", "OUT_FOR_DELIVERY"] } } });
    if (busy) throw new AppError("VEHICLE_ON_ROUTE", "This vehicle is out on a delivery. Finish or reassign it first.", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { status } });
    if (status !== "ACTIVE") await tx.delivery.updateMany({ where: { vehicleId: id, status: "ASSIGNED" }, data: { vehicleId: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `vehicle.${status.toLowerCase()}`, entityType: "Vehicle", entityId: id, before: { status: v.status }, after: { status, reason } }, tx);
  });
}

// ── drivers ─────────────────────────────────────────────────────────────────

export type DriverInput = { name: string; email: string; phone?: string | null; password: string; licenceNumber: string; licenceExpiry?: Date | null };

/** A vendor (or FIRINGI) adds a driver to its own fleet: creates the login + driver profile. */
export async function addDriver(ctx: Ctx, input: DriverInput) {
  requireManage(ctx, "drivers");
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Enter the driver's name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError("Enter a valid e-mail.");
  if (input.password.length < 10) throw new ValidationError("The password needs at least 10 characters.");
  const licence = input.licenceNumber.trim().toUpperCase();
  if (licence.length < 4) throw new ValidationError("Enter the driving licence number.");
  if (input.licenceExpiry && input.licenceExpiry < new Date()) throw new ValidationError("This driving licence has expired.");
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError("EMAIL_TAKEN", "A user with this e-mail already exists.", 409);
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: isAdmin(ctx) ? "ADMIN_DRIVER" : "VENDOR_DRIVER" } });
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name, phone: input.phone?.trim() || null, emailVerified: false } });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    await tx.membership.create({
      data: { userId: user.id, companyId: ctx.company.id, jobTitle: "Driver", createdById: ctx.user.id, roles: { create: [{ roleId: role.id, assignedById: ctx.user.id }] } },
    });
    const driver = await tx.driver.create({
      data: { userId: user.id, ownerCompanyId: ctx.company.id, licenceNumber: licence, licenceExpiry: input.licenceExpiry ?? null, status: "APPROVED", availability: "OFF_DUTY" },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "driver.added", entityType: "Driver", entityId: driver.id, after: { email, licence } }, tx);
    return driver;
  });
}

/** Owner suspends / reactivates its own driver; FIRINGI may suspend any driver (drivers.ts too). */
export async function setDriverActive(ctx: Ctx, driverId: string, active: boolean, reason?: string | null) {
  const d = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!d) throw new NotFoundError("Driver");
  const own = d.ownerCompanyId === ctx.company.id;
  if (own) requireManage(ctx, "drivers");
  else if (!(isAdmin(ctx) && can(ctx, "admin.fleet.manage"))) throw new NotFoundError("Driver");
  if (active && d.status !== "SUSPENDED") throw new ValidationError("Only a suspended driver can be reactivated.");
  if (!active && d.status !== "APPROVED") throw new ValidationError("Only an active driver can be suspended.");
  if (!active && !reason?.trim()) throw new ValidationError("Please give a reason.");
  if (!active) {
    const busy = await prisma.delivery.count({ where: { driverId, status: { in: ["PICKED_UP", "OUT_FOR_DELIVERY"] } } });
    if (busy) throw new AppError("DRIVER_ON_ROUTE", "This driver is out on a delivery. Finish or reassign it first.", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driverId }, data: { status: active ? "APPROVED" : "SUSPENDED", ...(active ? {} : { availability: "OFF_DUTY" }) } });
    if (!active) await tx.delivery.updateMany({ where: { driverId, status: "ASSIGNED" }, data: { driverId: null, status: "UNASSIGNED" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "driver.reactivated" : "driver.suspended", entityType: "Driver", entityId: driverId, before: { status: d.status }, after: { reason } }, tx);
  });
  if (!active) await notify("driver.suspended", [{ userId: d.userId, link: "/" }], { reason });
}

/** Driver sets own availability; the fleet owner may set it for its drivers. */
export async function setAvailability(ctx: Ctx, availability: DriverAvailability, driverId?: string) {
  const id = driverId ?? ctx.driver?.id;
  if (!id) throw new ForbiddenError();
  const d = await prisma.driver.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Driver");
  const self = ctx.driver?.id === id;
  if (self ? !can(ctx, "driver.deliveries.update") : d.ownerCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (!self) requireManage(ctx, "drivers");
  if (d.status !== "APPROVED") throw new ValidationError("This driver is not active.");
  await prisma.driver.update({ where: { id }, data: { availability } });
}

/** Active drivers and vehicles a dispatcher can assign (own fleet). */
export async function assignableFleet(companyId: string) {
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { ownerCompanyId: companyId, status: "APPROVED" }, select: { id: true, availability: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.vehicle.findMany({ where: { ownerCompanyId: companyId, status: "ACTIVE" }, select: { id: true, plate: true, type: true, isRefrigerated: true }, orderBy: { plate: "asc" } }),
  ]);
  return { drivers, vehicles };
}

/** The signed-in driver's own availability. */
export async function myAvailability(ctx: Ctx): Promise<DriverAvailability> {
  if (!ctx.driver) throw new ForbiddenError();
  return (await prisma.driver.findUniqueOrThrow({ where: { id: ctx.driver.id }, select: { availability: true } })).availability;
}
