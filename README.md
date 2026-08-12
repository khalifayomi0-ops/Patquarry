# Digital Sales Book — Inventory/Sales Synchronization Update

This update keeps the existing interface and changes only the requested behavior:

1. **Record Sale is hidden and inaccessible for Admin accounts.**
2. **Admin-added inventory is stored in Supabase and is therefore visible to Sales Rep accounts.**
3. **Sales are stored in Supabase and are visible in the Admin Total Sales report.**
4. **Recording a sale atomically decreases the selected inventory variant quantity.**
5. **Sales reps must select a Payment method when recording a sale.**
6. **Admin Total Sales includes the current remaining stock table.**

## Supabase configuration

In `script.js`, replace:

- `YOUR_SUPABASE_URL` with your Supabase project URL.
- `YOUR_SUPABASE_ANON_KEY` with your Supabase publishable/anon key.

Do **not** put an `sb_secret_...` key in the browser.

## Required SQL

Run `supabase_sales_inventory.sql` once in the Supabase SQL Editor.

It adds the `record_sale_v2` transaction function and the narrowly scoped RLS permissions needed for:

- authenticated users to read products/inventory/categories/payment methods;
- admins to add products and inventory;
- admins to view all sales;
- sales reps to view their own sales;
- sale recording to atomically insert the sale, insert the sale item, and reduce stock.

The existing username login RPC remains required:

```sql
create or replace function public.get_login_email(profile_username text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select au.email
  from public.profiles p
  join auth.users au on au.id = p.id
  where p.username = profile_username
    and coalesce(p.active, true) = true
  limit 1;
$$;

revoke all on function public.get_login_email(text) from public;
grant execute on function public.get_login_email(text) to anon, authenticated;
```

If the profile read policy is not already present:

```sql
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);
```

## Important

The frontend no longer uses localStorage for inventory or sales. Supabase is the source of truth, so an inventory change or sale is shared across Admin and Sales Rep accounts.

No other interface styling/assets were changed.

## Latest sales reporting adjustment
- Sales Rep dashboard "My sales" counts and amount are calculated for the current local calendar day only.
- Admin dashboard "Total sales today" is calculated for the current local calendar day only.
- The daily counters reset automatically at the start of a new day without deleting historical transactions.
- Admin navigation now includes "All Time Sales".
- All Time Sales keeps every historical transaction, groups totals by date, and each date opens its detailed daily sales report.

## Latest inventory management adjustment
- Admin Inventory now has a **Manage inventory** action.
- Admins can **Edit** product/category/color/size/pricing/threshold/current quantity.
- Admins can **Adjust** stock by a positive or negative quantity with a required reason; each adjustment is logged in `inventory_adjustments`.
- Admins can **Remove** inventory items. Existing sales history is not intentionally deleted; if a database foreign-key constraint prevents removal of an item with sales history, the item should instead be adjusted to 0 stock.
- Sales Rep inventory and all other existing functionality are unchanged.
- Run the updated `supabase_sales_inventory.sql` in Supabase SQL Editor to add the admin inventory-management permissions and `adjust_inventory_v2` function.

## Multi-business organization isolation (new)

The frontend now uses the logged-in profile's `organization_id` and filters inventory, sales and payment methods to that business. New products/inventory are stamped with the current organization.

Run `supabase_organization_isolation.sql` in Supabase SQL Editor after the existing sales/inventory SQL. This migration:

- adds `organization_id` to categories, products, inventory variants, payment methods and sales;
- assigns the existing catalog to **Admin 1 Business** and existing sales to the sales rep's organization;
- adds organization-aware RLS restrictions;
- prevents users from reading another organization's catalog, inventory or sales;
- creates organization-specific Cash, Bank Transfer and POS payment methods when missing;
- adds a trigger so the existing `record_sale_v2` function stamps new sales with the caller's organization;
- keeps the existing atomic sale/inventory transaction function intact.

Your verified accounts should therefore behave as follows:

- `admin` → Admin 1 Business → administrator
- `cashier1` → Admin 1 Business → sales representative
- `cashier2` → Admin 2 Business → sales representative

After running the migration, sign out and sign back in once so the browser session receives the latest `organization_id`.
