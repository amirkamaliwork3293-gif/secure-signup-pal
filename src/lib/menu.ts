import { supabase } from "@/integrations/supabase/client";

export type MenuCategory = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
};

export type MenuItem = {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  sort_order: number;
  is_available: boolean;
};

export async function listCategories(userId: string): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from("menu_categories")
    .select("id, user_id, name, sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MenuCategory[];
}

export async function listItems(userId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, user_id, category_id, name, description, price, image_url, sort_order, is_available")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MenuItem[];
}

export async function createCategory(userId: string, name: string): Promise<MenuCategory> {
  const { data, error } = await supabase
    .from("menu_categories")
    .insert({ user_id: userId, name: name.trim(), sort_order: Date.now() })
    .select("id, user_id, name, sort_order")
    .single();
  if (error) throw error;
  return data as MenuCategory;
}

export async function updateCategory(id: string, patch: Partial<Pick<MenuCategory, "name" | "sort_order">>) {
  const { error } = await supabase.from("menu_categories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("menu_categories").delete().eq("id", id);
  if (error) throw error;
}

export async function createItem(userId: string, item: Partial<MenuItem> & { name: string; price: number }): Promise<MenuItem> {
  const { data, error } = await supabase
    .from("menu_items")
    .insert({
      user_id: userId,
      name: item.name.trim(),
      price: item.price,
      description: item.description ?? null,
      category_id: item.category_id ?? null,
      image_url: item.image_url ?? null,
      sort_order: item.sort_order ?? Date.now(),
      is_available: item.is_available ?? true,
    })
    .select("id, user_id, category_id, name, description, price, image_url, sort_order, is_available")
    .single();
  if (error) throw error;
  return data as MenuItem;
}

export async function updateItem(id: string, patch: Partial<MenuItem>) {
  const { error } = await supabase.from("menu_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error) throw error;
}

/** آپلود عکس آیتم منو در باکت خصوصی + بازگرداندن لینک امضاشده با اعتبار ۱۰ سال. */
export async function uploadMenuImage(userId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("menu-images").upload(path, file, {
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  const { data: signed, error: signErr } = await supabase.storage
    .from("menu-images")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !signed) throw signErr ?? new Error("امکان ساخت لینک تصویر فراهم نشد.");
  return signed.signedUrl;
}

/** خواندن عمومی منوی یک فروشگاه (با شناسه کاربر) — بدون نیاز به ورود. */
export async function fetchPublicMenu(userId: string): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  const [cats, its] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, user_id, name, sort_order")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("menu_items")
      .select("id, user_id, category_id, name, description, price, image_url, sort_order, is_available")
      .eq("user_id", userId)
      .eq("is_available", true)
      .order("sort_order", { ascending: true }),
  ]);
  if (cats.error) throw cats.error;
  if (its.error) throw its.error;
  return {
    categories: (cats.data ?? []) as MenuCategory[],
    items: (its.data ?? []) as MenuItem[],
  };
}