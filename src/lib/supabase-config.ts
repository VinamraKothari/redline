/**
 * Public Supabase settings. Both values are designed to be shipped to browsers
 * (the publishable key only works through Row Level Security), so committing
 * them is safe. Environment variables override them when set.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hgvtqbfsdpnqcxidpmmu.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_HCQEz06AzGh-iaoJPLoNKQ_ZhyCrNg-";
