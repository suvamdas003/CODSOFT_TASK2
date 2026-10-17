"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { formDataToObject, parseInput, runAction, type ActionResult } from "@/lib/action";
import { idSchema, optionalText } from "@/lib/validation/common";
import {
  activeChangeSchema,
  addOnSchema,
  categorySchema,
  discountSchema,
  menuItemSchema,
  openingHoursSchema,
  roleChangeSchema,
  settingsSchema,
  staffCreateSchema,
  tableSchema,
  variantSchema,
} from "@/lib/validation/admin";
import { getSettings } from "@/server/repositories/settings-repository";
import { createDiscount, setDiscountActive } from "@/server/services/discount-service";
import * as menu from "@/server/services/menu-service";
import { markPaymentRefunded, recordManualPayment } from "@/server/services/payment-service";
import { updateOpeningHours, updateSettings } from "@/server/services/settings-service";
import { changeUserRole, createStaffAccount, setUserActive } from "@/server/services/staff-service";
import { createTable, deleteTable, updateTable } from "@/server/services/table-service";

type FormState = ActionResult<unknown> | null;

const optionKindSchema = z.enum(["variant", "addon"]);

const admin = () => getActor(["ADMIN"]);

function refreshMenu() {
  revalidatePath("/admin/menu");
  revalidatePath("/admin/categories");
  revalidatePath("/menu");
  revalidatePath("/");
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "saveCategory",
    async () => {
      const actor = await admin();
      const raw = formDataToObject(formData);
      const input = parseInput(categorySchema, raw);
      const id = typeof raw.id === "string" && raw.id ? raw.id : null;
      if (id) await menu.updateCategory(actor, id, input);
      else await menu.createCategory(actor, input);
      refreshMenu();
      return null;
    },
    "Category saved.",
  );
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  return runAction("deleteCategory", async () => {
    await menu.deleteCategory(await admin(), parseInput(idSchema, id));
    refreshMenu();
    return null;
  });
}

// ─── Menu items ─────────────────────────────────────────────────────────────

export async function saveMenuItemAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  let createdId: string | null = null;
  const result = await runAction(
    "saveMenuItem",
    async () => {
      const actor = await admin();
      const settings = await getSettings();
      const raw = formDataToObject(formData);
      const input = parseInput(menuItemSchema(settings.currency), raw);
      const id = typeof raw.id === "string" && raw.id ? raw.id : null;
      if (id) {
        await menu.updateMenuItem(actor, id, input);
        revalidatePath(`/admin/menu/${id}`);
      } else {
        createdId = (await menu.createMenuItem(actor, input)).id;
      }
      refreshMenu();
      return null;
    },
    "Menu item saved.",
  );
  if (result.ok && createdId) redirect(`/admin/menu/${createdId}?created=1`);
  return result;
}

export async function setItemAvailabilityAction(id: string, isAvailable: boolean): Promise<ActionResult> {
  return runAction("setItemAvailability", async () => {
    await menu.setMenuItemAvailability(await admin(), parseInput(idSchema, id), isAvailable === true);
    refreshMenu();
    return null;
  });
}

export async function archiveItemAction(id: string): Promise<ActionResult> {
  return runAction("archiveItem", async () => {
    await menu.archiveMenuItem(await admin(), parseInput(idSchema, id));
    refreshMenu();
    return null;
  });
}

export async function restoreItemAction(id: string): Promise<ActionResult> {
  return runAction("restoreItem", async () => {
    await menu.restoreMenuItem(await admin(), parseInput(idSchema, id));
    refreshMenu();
    return null;
  });
}

export async function addVariantAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "addVariant",
    async () => {
      const settings = await getSettings();
      const input = parseInput(variantSchema(settings.currency), formDataToObject(formData));
      await menu.addVariant(await admin(), input);
      revalidatePath(`/admin/menu/${input.menuItemId}`);
      refreshMenu();
      return null;
    },
    "Option added.",
  );
}

export async function addAddOnAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "addAddOn",
    async () => {
      const settings = await getSettings();
      const input = parseInput(addOnSchema(settings.currency), formDataToObject(formData));
      await menu.addAddOn(await admin(), input);
      revalidatePath(`/admin/menu/${input.menuItemId}`);
      refreshMenu();
      return null;
    },
    "Extra added.",
  );
}

export async function setOptionAvailabilityAction(kind: "variant" | "addon", id: string, isAvailable: boolean): Promise<ActionResult> {
  return runAction("setOptionAvailability", async () => {
    const actor = await admin();
    const optionId = parseInput(idSchema, id);
    const optionKind = parseInput(optionKindSchema, kind);
    if (optionKind === "variant") await menu.setVariantAvailability(actor, optionId, isAvailable === true);
    else await menu.setAddOnAvailability(actor, optionId, isAvailable === true);
    refreshMenu();
    revalidatePath("/admin/menu/[id]", "page");
    return null;
  });
}

export async function deleteOptionAction(kind: "variant" | "addon", id: string): Promise<ActionResult> {
  return runAction("deleteOption", async () => {
    const actor = await admin();
    const optionId = parseInput(idSchema, id);
    const optionKind = parseInput(optionKindSchema, kind);
    if (optionKind === "variant") await menu.deleteVariant(actor, optionId);
    else await menu.deleteAddOn(actor, optionId);
    refreshMenu();
    revalidatePath("/admin/menu/[id]", "page");
    return null;
  });
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function saveTableAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "saveTable",
    async () => {
      const actor = await admin();
      const raw = formDataToObject(formData);
      const input = parseInput(tableSchema, raw);
      const id = typeof raw.id === "string" && raw.id ? raw.id : null;
      if (id) await updateTable(actor, id, input);
      else await createTable(actor, input);
      revalidatePath("/admin/tables");
      return null;
    },
    "Table saved.",
  );
}

export async function deleteTableAction(id: string): Promise<ActionResult> {
  return runAction("deleteTable", async () => {
    await deleteTable(await admin(), parseInput(idSchema, id));
    revalidatePath("/admin/tables");
    return null;
  });
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function createStaffAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "createStaff",
    async () => {
      await createStaffAccount(await admin(), parseInput(staffCreateSchema, formDataToObject(formData)));
      revalidatePath("/admin/staff");
      return null;
    },
    "Account created. Share the temporary password securely and ask them to keep it private.",
  );
}

export async function changeRoleAction(input: z.input<typeof roleChangeSchema>): Promise<ActionResult> {
  return runAction("changeRole", async () => {
    await changeUserRole(await admin(), parseInput(roleChangeSchema, input));
    revalidatePath("/admin/staff");
    return null;
  });
}

export async function setUserActiveAction(input: z.input<typeof activeChangeSchema>): Promise<ActionResult> {
  return runAction("setUserActive", async () => {
    await setUserActive(await admin(), parseInput(activeChangeSchema, input));
    revalidatePath("/admin/staff");
    return null;
  });
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "saveSettings",
    async () => {
      const actor = await admin();
      const current = await getSettings();
      const raw = formDataToObject(formData);
      // Amounts are entered in the currency being saved (validated below).
      const input = parseInput(
        settingsSchema(typeof raw.currency === "string" && raw.currency.length === 3 ? raw.currency.toUpperCase() : current.currency),
        raw,
      );
      await updateSettings(actor, input);
      revalidatePath("/", "layout");
      return null;
    },
    "Settings saved.",
  );
}

export async function saveOpeningHoursAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "saveOpeningHours",
    async () => {
      const actor = await admin();
      const days = Array.from({ length: 7 }, (_, day) => ({
        dayOfWeek: day,
        isClosed: formData.get(`closed-${day}`) === "on",
        open: String(formData.get(`open-${day}`) ?? ""),
        close: String(formData.get(`close-${day}`) ?? ""),
      })).map((day) => (day.isClosed ? { ...day, open: "00:00", close: "00:00" } : day));
      const parsed = parseInput(openingHoursSchema, days);
      await updateOpeningHours(actor, parsed);
      revalidatePath("/", "layout");
      return null;
    },
    "Opening hours saved.",
  );
}

// ─── Discounts ──────────────────────────────────────────────────────────────

export async function createDiscountAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "createDiscount",
    async () => {
      const actor = await admin();
      const settings = await getSettings();
      await createDiscount(actor, parseInput(discountSchema, formDataToObject(formData)), settings.currency);
      revalidatePath("/admin/discounts");
      return null;
    },
    "Discount code created.",
  );
}

export async function setDiscountActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  return runAction("setDiscountActive", async () => {
    await setDiscountActive(await admin(), parseInput(idSchema, id), isActive === true);
    revalidatePath("/admin/discounts");
    return null;
  });
}

// ─── Payments ───────────────────────────────────────────────────────────────

const manualPaymentSchema = z.object({ orderId: idSchema, reference: optionalText(60) });
const refundSchema = z.object({ paymentId: idSchema, orderId: idSchema, note: optionalText(200) });

export async function recordManualPaymentAction(_prev: FormState, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    "recordManualPayment",
    async () => {
      const input = parseInput(manualPaymentSchema, formDataToObject(formData));
      await recordManualPayment(await admin(), input);
      revalidatePath(`/admin/orders/${input.orderId}`);
      revalidatePath("/admin/orders");
      return null;
    },
    "Manual payment recorded.",
  );
}

export async function markRefundedAction(input: z.input<typeof refundSchema>): Promise<ActionResult> {
  return runAction("markRefunded", async () => {
    const parsed = parseInput(refundSchema, input);
    await markPaymentRefunded(await admin(), parsed);
    revalidatePath(`/admin/orders/${parsed.orderId}`);
    return null;
  });
}
