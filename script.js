/* Digital Sales Book
   Static HTML/CSS/JS frontend backed by Supabase.
   Business data is read from Supabase so admin inventory and sales-rep sales stay synchronized.
*/

const $ = (selector) => document.querySelector(selector);
const app = $("#app");

const SUPABASE_URL = "https://omgqhxzfvjtrlyvojgdy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9QN_FD2KtFOFikpU4WyEFQ_56i0wfvx";

let supabaseClient = null;
let me = null;

const db = {
  inventory: [],
  sales: [],
  paymentMethods: []
};

const money = (n) => "₦" + Number(n || 0).toLocaleString("en-NG");
function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const today = localToday;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function supabaseReady() {
  return !!supabaseClient;
}

function getErrorMessage(error, fallback = "Something went wrong.") {
  return error?.message || error?.details || error?.hint || fallback;
}

function login() {
  app.innerHTML = `
    <div class="auth-shell page page-login" style="--bg-image:url('assets/store-1.jpg')">
      <div class="auth-overlay"></div>
      <section class="login-card">
        <div class="brand-mark">DS</div>
        <p class="eyebrow">Simple retail management</p>
        <h1>Digital Sales Book</h1>
        <p class="muted">Track stock, record sales and keep your store organized.</p>

        <form onsubmit="event.preventDefault(); doLogin()">
          <label>Username
            <input id="u" autocomplete="username" placeholder="Enter username">
          </label>
          <label>Password
            <input id="p" type="password" autocomplete="current-password" placeholder="Enter password">
          </label>
          <button class="primary" type="submit">Sign in</button>
        </form>

        <div class="demo-login">
          <strong>Sign in with your username</strong>
          <span>Your username is the one saved in the Supabase <b>profiles</b> table.</span>
        </div>
      </section>
    </div>
  `;
}

window.doLogin = async () => {
  const username = $("#u").value.trim();
  const password = $("#p").value;

  if (!username || !password) {
    alert("Enter your username and password.");
    return;
  }

  if (!supabaseReady()) {
    alert("Supabase is not configured yet. Add your project URL and publishable key in script.js.");
    return;
  }

  try {
    const { data: authEmail, error: emailError } =
      await supabaseClient.rpc("get_login_email", {
        profile_username: username
      });

    if (emailError) {
      console.error("Username lookup error:", emailError);
      alert("Could not look up that username. Check the Supabase RPC function and username.");
      return;
    }

    if (!authEmail) {
      alert("Username not found.");
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: authEmail,
      password
    });

    if (error) throw error;
    if (!data.user) {
      alert("Login failed.");
      return;
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("id, username, full_name, role, active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup error:", profileError);
      await supabaseClient.auth.signOut();
      alert("Login succeeded, but your profile could not be loaded. Check the profiles RLS policy.");
      return;
    }

    if (!profile) {
      await supabaseClient.auth.signOut();
      alert("Your login account has no matching profile.");
      return;
    }

    if (profile.active === false) {
      await supabaseClient.auth.signOut();
      alert("This account is inactive. Please contact the owner.");
      return;
    }

    if (profile.username !== username) {
      await supabaseClient.auth.signOut();
      alert("This login account is not connected to that username.");
      return;
    }

    me = {
      u: profile.username,
      n: profile.full_name || profile.username,
      r: profile.role === "admin" ? "admin" : "rep",
      id: profile.id,
      active: profile.active
    };
    sessionStorage.setItem("me", JSON.stringify(me));

    await loadData();
    home("dashboard");
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Login failed."));
  }
};

window.logout = async () => {
  sessionStorage.removeItem("me");
  if (supabaseClient) {
    try { await supabaseClient.auth.signOut(); } catch {}
  }
  location.reload();
};

async function loadData() {
  if (!supabaseReady() || !me) return;

  const inventoryQuery = supabaseClient
    .from("inventory_variants")
    .select(`
      id,
      product_id,
      color,
      size,
      quantity,
      selling_price,
      cost_price,
      low_stock_threshold,
      updated_at,
      products (
        id,
        product_name,
        sku,
        category_id,
        categories (
          id,
          name
        )
      )
    `)
    .order("updated_at", { ascending: false });

  const salesQuery = supabaseClient
    .from("sales")
    .select(`
      id,
      sales_rep_id,
      sale_date,
      total_amount,
      payment_method_id,
      customer_name,
      customer_phone,
      notes,
      status,
      created_at,
      payment_methods (
        id,
        name
      ),
      sale_items (
        quantity,
        product_id,
        products (
          product_name
        )
      )
    `)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });

  const [inventoryResult, salesResult, paymentResult] = await Promise.all([
    inventoryQuery,
    salesQuery,
    supabaseClient.from("payment_methods").select("id, name, active").eq("active", true).order("name")
  ]);

  if (inventoryResult.error) throw inventoryResult.error;
  if (salesResult.error) throw salesResult.error;
  if (paymentResult.error) throw paymentResult.error;

  db.inventory = (inventoryResult.data || []).map(v => ({
    id: v.id,
    productId: v.product_id,
    p: v.products?.product_name || "Unknown product",
    sku: v.products?.sku || "",
    c: v.products?.categories?.name || "—",
    categoryId: v.products?.category_id || "",
    color: v.color || "—",
    size: v.size || "—",
    q: Number(v.quantity || 0),
    price: Number(v.selling_price || 0),
    cost: Number(v.cost_price || 0),
    low: Number(v.low_stock_threshold ?? 5),
    updatedAt: v.updated_at
  }));

  db.sales = (salesResult.data || []).map(s => ({
    id: s.id,
    d: s.sale_date,
    amt: Number(s.total_amount || 0),
    repId: s.sales_rep_id,
    rep: s.sales_rep_id === me.id ? me.n : s.sales_rep_id,
    customer: s.customer_name || "",
    customerPhone: s.customer_phone || "",
    notes: s.notes || "",
    status: s.status || "",
    paymentMethodId: s.payment_method_id,
    paymentMethod: s.payment_methods?.name || "—",
    qty: Number(s.sale_items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0),
    product: s.sale_items?.map(item => item.products?.product_name).filter(Boolean).join(", ") || "Sale",
    createdAt: s.created_at
  }));

  db.paymentMethods = paymentResult.data || [];
}

function home(active = "dashboard") {
  const admin = me.r === "admin";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark small">DS</div>
          <div>
            <strong>Digital Sales Book</strong>
            <span>Retail workspace</span>
          </div>
        </div>
        <div class="user-area">
          <div class="avatar">${esc((me.n || "U").charAt(0).toUpperCase())}</div>
          <div class="user-copy">
            <strong>${esc(me.n)}</strong>
            <span>${admin ? "Administrator" : "Sales representative"}</span>
          </div>
          <button class="ghost small-btn" onclick="logout()">Log out</button>
        </div>
      </header>

      <nav class="tabs" aria-label="Main navigation">
        <button class="tab ${active === "dashboard" ? "active" : ""}" onclick="showTab('dashboard')">Overview</button>
        <button class="tab ${active === "inventory" ? "active" : ""}" onclick="showTab('inventory')">Inventory</button>
        ${!admin ? `<button class="tab ${active === "sale" ? "active" : ""}" onclick="showTab('sale')">Record Sale</button>` : ""}
        ${admin ? `<button class="tab ${active === "reports" ? "active" : ""}" onclick="showTab('reports')">All Time Sales</button>` : ""}
      </nav>

      <main id="v" class="content"></main>
    </div>
  `;
  showTab(active);
}

window.showTab = async (tab) => {
  if (tab === "sale" && me?.r === "admin") {
    return showTab("dashboard");
  }

  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  const activeButton = [...document.querySelectorAll(".tab")].find((b) =>
    b.getAttribute("onclick")?.includes(`'${tab}'`)
  );
  activeButton?.classList.add("active");

  try {
    await loadData();
    if (tab === "dashboard") renderDashboard();
    if (tab === "inventory") renderInventory();
    if (tab === "sale") await renderSale();
    if (tab === "reports") renderReports();
  } catch (err) {
    console.error(err);
    $("#v").innerHTML = pageWrap("dashboard-page", "store-2.jpg",
      `<div class="glass-card"><div class="empty">${esc(getErrorMessage(err, "Could not load data."))}</div></div>`
    );
  }
};

function pageWrap(cls, image, content) {
  return `
    <section class="page-panel ${cls}" style="--bg-image:url('assets/${image}')">
      <div class="page-bg"></div>
      <div class="page-content">${content}</div>
    </section>
  `;
}

function renderDashboard() {
  const totalStock = db.inventory.reduce((sum, i) => sum + i.q, 0);
  const totalValue = db.inventory.reduce((sum, i) => sum + i.q * i.price, 0);
  // Dashboard sales counters are intentionally day-based. Historical sales remain
  // untouched in Supabase and are shown in the Admin "All Time Sales" report.
  const todayDate = localToday();
  const todaySales = db.sales.filter((s) => s.d === todayDate);
  const totalSalesToday = todaySales.reduce((sum, s) => sum + s.amt, 0);
  const mySalesToday = todaySales.filter((s) => s.repId === me.id);
  const myTotalToday = mySalesToday.reduce((sum, s) => sum + s.amt, 0);
  const lowStock = db.inventory.filter((i) => i.q <= i.low);

  const recent = [...db.sales].sort((a,b) => `${b.d}${b.createdAt}`.localeCompare(`${a.d}${a.createdAt}`)).slice(0, 5);

  $("#v").innerHTML = pageWrap("dashboard-page", "store-2.jpg", `
    <div class="hero">
      <div>
        <p class="eyebrow">Welcome back, ${esc(me.n)}</p>
        <h1>Run your store at a glance.</h1>
        <p class="muted">Everything you need is kept simple and close at hand.</p>
      </div>
      ${me.r === "rep" ? `<button class="primary hero-action" onclick="showTab('sale')">+ Record a sale</button>` : ""}
    </div>

    <div class="stats">
      <article class="stat-card">
        <span>Items in stock</span>
        <strong>${totalStock}</strong>
        <small>${db.inventory.length} products</small>
      </article>
      <article class="stat-card">
        <span>Inventory value</span>
        <strong>${money(totalValue)}</strong>
        <small>Current stock value</small>
      </article>
      <article class="stat-card">
        <span>${me.r === "admin" ? "Total sales today" : "My sales"}</span>
        <strong>${money(me.r === "admin" ? totalSalesToday : myTotalToday)}</strong>
        <small>${me.r === "admin" ? todaySales.length : mySalesToday.length} transaction${(me.r === "admin" ? todaySales.length : mySalesToday.length) === 1 ? "" : "s"} today</small>
      </article>
      <article class="stat-card ${lowStock.length ? "warning" : ""}">
        <span>Low stock</span>
        <strong>${lowStock.length}</strong>
        <small>${lowStock.length ? "Needs attention" : "Stock looks healthy"}</small>
      </article>
    </div>

    <div class="two-col">
      <div class="glass-card">
        <div class="section-head">
          <div><p class="eyebrow">Recent activity</p><h2>Latest sales</h2></div>
          ${me.r === "admin" ? `<button class="text-btn" onclick="showTab('reports')">View all</button>` : ""}
        </div>
        ${recent.length ? `
          <div class="activity-list">
            ${recent.map(s => `
              <div class="activity-row">
                <div class="activity-icon">₦</div>
                <div class="activity-main"><strong>${esc(s.customer || "Sale")}</strong><span>${esc(s.paymentMethod)} · ${esc(s.d)}</span></div>
                <strong>${money(s.amt)}</strong>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty">No sales recorded yet.</div>`}
      </div>

      <div class="glass-card">
        <div class="section-head"><div><p class="eyebrow">Stock watch</p><h2>Products</h2></div></div>
        <div class="mini-products">
          ${db.inventory.slice(0, 5).map(i => `
            <div class="mini-product">
              <div><strong>${esc(i.p)}</strong><span>${esc(i.color)} · ${esc(i.c)}</span></div>
              <b class="${i.q <= i.low ? "stock-low" : ""}">${i.q} left</b>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `);
}

function renderInventory() {
  $("#v").innerHTML = pageWrap("inventory-page", "store-3.jpg", `
    <div class="page-heading">
      <div>
        <p class="eyebrow">Stock management</p>
        <h1>Inventory</h1>
        <p class="muted">See what you have, what it costs and what needs restocking.</p>
      </div>
      ${me.r === "admin" ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="ghost" onclick="manageInv()">Manage inventory</button><button class="primary" onclick="addInv()">+ Add inventory</button></div>` : ""}
    </div>

    <div class="glass-card table-card">
      <div class="table-tools">
        <input id="inventorySearch" oninput="filterInventory()" placeholder="Search products...">
        <span>${db.inventory.length} products</span>
      </div>
      <div class="table-wrap">
        <table id="inventoryTable">
          <thead><tr><th>Product</th><th>Color</th><th>Stock</th><th>Price</th></tr></thead>
          <tbody>
            ${db.inventory.map(i => `
              <tr>
                <td><strong>${esc(i.p)}</strong>${i.size !== "—" ? `<br><span class="subtle">Size: ${esc(i.size)}</span>` : ""}</td>
                         <td>${esc(i.color)}</td>
                <td><span class="stock-pill ${i.q <= i.low ? "low" : ""}">${i.q}</span></td>
                <td><strong>${money(i.price)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
}

window.filterInventory = () => {
  const term = ($("#inventorySearch")?.value || "").toLowerCase();
  document.querySelectorAll("#inventoryTable tbody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
  });
};

window.manageInv = async () => {
  if (me.r !== "admin") return showTab("inventory");

  await loadData();
  const rows = db.inventory.map(i => `
    <tr>
      <td><strong>${esc(i.p)}</strong>${i.size !== "—" ? `<br><span class="subtle">Size: ${esc(i.size)}</span>` : ""}</td>
      <td>${esc(i.c)}</td>
      <td>${esc(i.color)}</td>
      <td><span class="stock-pill ${i.q <= i.low ? "low" : ""}">${i.q}</span></td>
      <td>${money(i.price)}</td>
      <td>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="text-btn" onclick="editInv('${i.id}')">Edit</button>
          <button class="text-btn" onclick="adjustInv('${i.id}')">Adjust</button>
          <button class="text-btn" onclick="removeInv('${i.id}')">Remove</button>
        </div>
      </td>
    </tr>
  `).join("");

  $("#v").innerHTML = pageWrap("inventory-page", "store-3.jpg", `
    <div class="page-heading">
      <div>
        <p class="eyebrow">Inventory</p>
        <h1>Manage inventory</h1>
        <p class="muted">Add, edit, adjust or remove inventory items.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="ghost" onclick="showTab('inventory')">← Back</button>
        <button class="primary" onclick="addInv()">+ Add inventory</button>
      </div>
    </div>

    <div class="glass-card table-card">
      <div class="table-tools">
        <input id="manageInventorySearch" oninput="filterManageInventory()" placeholder="Search products...">
        <span>${db.inventory.length} products</span>
      </div>
      <div class="table-wrap">
        <table id="manageInventoryTable">
          <thead><tr><th>Product</th><th>Color</th><th>Stock</th><th>Price</th><th>Actions</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5"><div class="empty">No inventory items found.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `);
};

window.filterManageInventory = () => {
  const term = ($("#manageInventorySearch")?.value || "").toLowerCase();
  document.querySelectorAll("#manageInventoryTable tbody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
  });
};

window.editInv = async (id) => {
  if (me.r !== "admin") return;
  const item = db.inventory.find(i => String(i.id) === String(id));
  if (!item) return alert("Inventory item not found.");

  $("#v").innerHTML = pageWrap("inventory-page", "store-3.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Inventory</p><h1>Edit inventory</h1><p class="muted">Update the product and inventory details.</p></div>
      <button class="ghost" onclick="manageInv()">← Back</button>
    </div>
    <div class="glass-card form-card">
      <form onsubmit="event.preventDefault(); saveEditInv('${item.id}')">
        <div class="form-grid">
          <label>Product name<input id="editProduct" required value="${esc(item.p)}"></label>
          <label>Color<input id="editColor" required value="${esc(item.color === "—" ? "" : item.color)}"></label>
          <label>Size<input id="editSize" value="${esc(item.size === "—" ? "" : item.size)}"></label>
          <label>Selling price (₦)<input id="editPrice" required type="number" min="0" step="0.01" value="${item.price}"></label>
          <label>Cost price (₦)<input id="editCost" required type="number" min="0" step="0.01" value="${item.cost}"></label>
          <label>Low-stock threshold<input id="editLow" required type="number" min="0" step="1" value="${item.low}"></label>
          <label>Current quantity<input id="editQty" required type="number" min="0" step="1" value="${item.q}"></label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="primary" type="submit">Save changes</button>
          <button class="ghost" type="button" onclick="manageInv()">Cancel</button>
        </div>
      </form>
    </div>
  `);
};

window.saveEditInv = async (id) => {
  if (me.r !== "admin") return alert("Only an administrator can edit inventory.");
  const item = db.inventory.find(i => String(i.id) === String(id));
  if (!item) return alert("Inventory item not found.");

  const productName = $("#editProduct").value.trim();
  const color = $("#editColor").value.trim();
  const size = $("#editSize").value.trim() || null;
  const price = Number($("#editPrice").value);
  const cost = Number($("#editCost").value);
  const low = Number($("#editLow").value);
  const quantity = Number($("#editQty").value);

  if (!productName || !color) return alert("Complete all required product fields.");
  if (![price, cost].every(Number.isFinite) || price < 0 || cost < 0) return alert("Enter valid prices.");
  if (!Number.isInteger(low) || low < 0) return alert("Enter a valid low-stock threshold.");
  if (!Number.isInteger(quantity) || quantity < 0) return alert("Enter a valid quantity.");

  try {
    const { error: productError } = await supabaseClient
      .from("products")
      .update({ product_name: productName })
      .eq("id", item.productId);
    if (productError) throw productError;

    const { error: variantError } = await supabaseClient
      .from("inventory_variants")
      .update({
        color,
        size,
        quantity,
        selling_price: price,
        cost_price: cost,
        low_stock_threshold: low,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);
    if (variantError) throw variantError;

    const delta = quantity - item.q;
    if (delta !== 0) {
      const { error: adjustmentError } = await supabaseClient
        .from("inventory_adjustments")
        .insert({
          inventory_variant_id: item.id,
          quantity_change: delta,
          reason: "Inventory edited by admin",
          performed_by: me.id
        });
      if (adjustmentError) console.error("Adjustment log error:", adjustmentError);
    }

    await loadData();
    alert("Inventory updated successfully.");
    manageInv();
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Could not update inventory."));
  }
};

window.adjustInv = async (id) => {
  if (me.r !== "admin") return;
  const item = db.inventory.find(i => String(i.id) === String(id));
  if (!item) return alert("Inventory item not found.");

  $("#v").innerHTML = pageWrap("inventory-page", "store-3.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Inventory</p><h1>Adjust stock</h1><p class="muted">Increase or decrease the current quantity. The adjustment is logged.</p></div>
      <button class="ghost" onclick="manageInv()">← Back</button>
    </div>
    <div class="glass-card form-card">
      <form onsubmit="event.preventDefault(); saveAdjustInv('${item.id}')">
        <div class="sale-preview"><span>Current stock</span><strong>${item.q}</strong></div>
        <div class="form-grid">
          <label>Adjustment quantity<input id="adjustQty" required type="number" step="1" placeholder="e.g. 10 or -3"></label>
          <label>Reason<input id="adjustReason" required placeholder="e.g. New stock received"></label>
        </div>
        <div class="sale-preview"><span>New stock</span><strong id="adjustNewQty">${item.q}</strong></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="primary" type="submit">Save adjustment</button>
          <button class="ghost" type="button" onclick="manageInv()">Cancel</button>
        </div>
      </form>
    </div>
  `);
  $("#adjustQty")?.addEventListener("input", () => {
    const delta = Number($("#adjustQty").value || 0);
    $("#adjustNewQty").textContent = String(item.q + (Number.isFinite(delta) ? delta : 0));
  });
};

window.saveAdjustInv = async (id) => {
  if (me.r !== "admin") return alert("Only an administrator can adjust inventory.");
  const delta = Number($("#adjustQty").value);
  const reason = $("#adjustReason").value.trim();
  if (!Number.isInteger(delta) || delta === 0) return alert("Enter a non-zero whole-number adjustment.");
  if (!reason) return alert("Enter a reason for the adjustment.");

  try {
    const { error } = await supabaseClient.rpc("adjust_inventory_v2", {
      p_inventory_variant_id: id,
      p_quantity_change: delta,
      p_reason: reason
    });
    if (error) throw error;
    await loadData();
    alert("Inventory adjustment saved successfully.");
    manageInv();
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Could not adjust inventory."));
  }
};

window.removeInv = async (id) => {
  if (me.r !== "admin") return;
  const item = db.inventory.find(i => String(i.id) === String(id));
  if (!item) return alert("Inventory item not found.");
  if (!confirm(`Remove "${item.p}" from inventory? This does not remove its historical sales.`)) return;

  try {
    const { error } = await supabaseClient
      .from("inventory_variants")
      .delete()
      .eq("id", item.id);
    if (error) throw error;

    const { data: remaining, error: remainingError } = await supabaseClient
      .from("inventory_variants")
      .select("id")
      .eq("product_id", item.productId);
    if (remainingError) throw remainingError;

    if (!(remaining || []).length) {
      const { error: productError } = await supabaseClient.from("products").delete().eq("id", item.productId);
      if (productError) console.warn("Product record could not be removed:", productError);
    }

    await loadData();
    alert("Inventory item removed.");
    manageInv();
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Could not remove this inventory item. If it has sales history, keep it and adjust its stock to 0 instead."));
  }
};

window.addInv = async () => {
  if (me.r !== "admin") return;

  $("#v").innerHTML = pageWrap("inventory-page", "store-3.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Inventory</p><h1>Add product</h1><p class="muted">Add a new item to your store stock.</p></div>
      <button class="ghost" onclick="showTab('inventory')">← Back</button>
    </div>
    <div class="glass-card form-card">
      <form onsubmit="event.preventDefault(); saveInv()">
        <div class="form-grid">
          <label>Product name<input id="newProduct" required placeholder="e.g. Canvas Bag"></label>
          <label>Color<input id="newColor" required placeholder="e.g. Brown"></label>
          <label>Quantity<input id="newQty" required type="number" min="0" placeholder="0"></label>
          <label>Price (₦)<input id="newPrice" required type="number" min="0" placeholder="0"></label>
        </div>
        <button class="primary" type="submit">Save product</button>
      </form>
    </div>
  `);
};

window.saveInv = async () => {
  if (me.r !== "admin") return alert("Only an administrator can add inventory.");

  const productName = $("#newProduct").value.trim();
  const color = $("#newColor").value.trim();
  const quantity = Number($("#newQty").value);
  const price = Number($("#newPrice").value);

  if (!productName || !color) return alert("Complete all product fields.");
  if (!Number.isInteger(quantity) || quantity < 0) return alert("Enter a valid quantity.");
  if (!Number.isFinite(price) || price < 0) return alert("Enter a valid price.");

  const skuBase = productName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const sku = `${skuBase || "PRODUCT"}-${Date.now().toString().slice(-6)}`;

  try {
    const { data: product, error: productError } = await supabaseClient
      .from("products")
      .insert({
        product_name: productName,
        sku
      })
      .select("id, product_name, sku")
      .single();

    if (productError) throw productError;

    const { data: variant, error: variantError } = await supabaseClient
      .from("inventory_variants")
      .insert({
        product_id: product.id,
        color,
        size: null,
        quantity,
        selling_price: price,
        cost_price: 0,
        low_stock_threshold: 5
      })
      .select("id")
      .single();

    if (variantError) {
      // Keep the database clean if the variant insert fails.
      await supabaseClient.from("products").delete().eq("id", product.id);
      throw variantError;
    }

    if (quantity > 0) {
      const { error: adjustmentError } = await supabaseClient
        .from("inventory_adjustments")
        .insert({
          inventory_variant_id: variant.id,
          quantity_change: quantity,
          reason: "Initial inventory",
          performed_by: me.id
        });

      if (adjustmentError) {
        console.error("Inventory adjustment log error:", adjustmentError);
      }
    }

    await loadData();
    alert("Product saved successfully.");
    showTab("inventory");
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Could not save the product."));
  }
};

async function renderSale() {
  if (me.r !== "rep") return showTab("dashboard");

  const available = db.inventory.filter(i => i.q > 0);
  const options = available.map(i =>
    `<option value="${esc(i.id)}">${esc(i.p)} — ${esc(i.color)} · ${i.q} left · ${money(i.price)}</option>`
  ).join("");

  $("#v").innerHTML = pageWrap("sale-page", "store-4.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Sales</p><h1>Record a sale</h1><p class="muted">Choose an item, enter the quantity and save the transaction.</p></div>
    </div>
    <div class="glass-card form-card sale-form-card">
      ${available.length ? `
      <form onsubmit="event.preventDefault(); saveSale()">
        <label>Product<select id="item" required>${options}</select></label>
        <div class="form-grid">
          <label>Quantity<input id="qty" type="number" min="1" value="1" required></label>
          <label>Date<input id="date" type="date" value="${today()}" required></label>
          <label>Payment method
            <select id="paymentMethod" required>
              <option value="">Select payment method</option>
              ${db.paymentMethods.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
            </select>
          </label>
          <label>Customer name <span class="optional">optional</span><input id="customer" placeholder="Customer name"></label>
        </div>
        <div id="salePreview" class="sale-preview">Select a product to see the total.</div>
        <button class="primary" type="submit">Save sale</button>
      </form>
      ` : `<div class="empty">No available products in inventory.</div>`}
    </div>
  `);

  $("#item")?.addEventListener("change", updateSalePreview);
  $("#qty")?.addEventListener("input", updateSalePreview);
  updateSalePreview();
}

function updateSalePreview() {
  const item = db.inventory.find(x => String(x.id) === String($("#item")?.value));
  const qty = Number($("#qty")?.value || 1);
  const preview = $("#salePreview");
  if (!item || !preview) return;
  preview.innerHTML = `<span>${esc(item.p)} × ${qty}</span><strong>${money(item.price * qty)}</strong>`;
}

window.saveSale = async () => {
  if (me.r !== "rep") return alert("Only a sales representative can record a sale.");

  const item = db.inventory.find(x => String(x.id) === String($("#item").value));
  const qty = Number($("#qty").value);
  const paymentMethodId = $("#paymentMethod").value;

  if (!item) return alert("Please select a product.");
  if (!Number.isInteger(qty) || qty < 1) return alert("Enter a valid quantity.");
  if (qty > item.q) return alert("Not enough stock.");
  if (!paymentMethodId) return alert("Select a payment method.");

  try {
    const { data: saleId, error } = await supabaseClient.rpc("record_sale_v2", {
      p_sales_rep_id: me.id,
      p_sale_date: $("#date").value,
      p_inventory_variant_id: item.id,
      p_product_id: item.productId,
      p_quantity: qty,
      p_unit_price: item.price,
      p_payment_method_id: paymentMethodId,
      p_customer_name: $("#customer").value.trim(),
      p_customer_phone: null,
      p_notes: null
    });

    if (error) throw error;

    await loadData();
    alert("Sale saved successfully.");
    showTab("dashboard");
  } catch (err) {
    console.error(err);
    alert(getErrorMessage(err, "Could not record the sale."));
  }
};

function renderReports() {
  if (me.r !== "admin") return showTab("dashboard");

  const groups = {};
  db.sales.forEach((s) => {
    groups[s.d] ??= { amt: 0, qty: 0, count: 0 };
    groups[s.d].amt += Number(s.amt || 0);
    groups[s.d].qty += Number(s.qty || 0);
    groups[s.d].count += 1;
  });

  const dates = Object.keys(groups).sort().reverse();
  const grandTotal = db.sales.reduce((sum, s) => sum + Number(s.amt || 0), 0);

  $("#v").innerHTML = pageWrap("reports-page", "store-5.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Admin report</p><h1>All time sales</h1><p class="muted">View all transactions grouped by date. Click any date to open that day's sales report.</p></div>
      <div class="report-total"><span>All-time total</span><strong>${money(grandTotal)}</strong></div>
    </div>

    <div class="report-grid">
      ${dates.length ? dates.map(d => `
        <button class="day-card" onclick="day('${esc(d)}')">
          <span>${esc(d)}</span>
          <strong>${money(groups[d].amt)}</strong>
          <small>${groups[d].count} transaction${groups[d].count === 1 ? "" : "s"} · ${groups[d].qty} item${groups[d].qty === 1 ? "" : "s"} sold</small>
          <b>View →</b>
        </button>
      `).join("") : `<div class="glass-card empty">No sales yet.</div>`}
    </div>
  `);
}

window.day = (d) => {
  if (me.r !== "admin") return showTab("dashboard");

  const rows = db.sales.filter(s => s.d === d);
  const total = rows.reduce((sum, s) => sum + Number(s.amt || 0), 0);

  $("#v").innerHTML = pageWrap("reports-page", "store-5.jpg", `
    <div class="page-heading">
      <div><p class="eyebrow">Sales report</p><h1>${esc(d)}</h1><p class="muted">${rows.length} transaction${rows.length === 1 ? "" : "s"} · ${money(total)}</p></div>
      <button class="ghost" onclick="showTab('reports')">← Back</button>
    </div>
    <div class="glass-card table-card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Qty</th><th>Amount</th><th>Sales rep</th><th>Payment</th><th>Customer</th></tr></thead>
          <tbody>
            ${rows.map(s => `
              <tr>
                <td><strong>${esc(findSaleProduct(s))}</strong></td>
                <td>${esc(s.qty ?? "—")}</td>
                <td><strong>${money(s.amt)}</strong></td>
                <td>${esc(s.rep)}</td>
                <td>${esc(s.paymentMethod)}</td>
                <td>${esc(s.customer || "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="glass-card table-card" style="margin-top:18px">
      <div class="section-head" style="padding:18px 20px 0"><div><p class="eyebrow">Current stock</p><h2>Remaining products</h2></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Color</th><th>Remaining stock</th><th>Price</th></tr></thead>
          <tbody>
            ${db.inventory.map(i => `
              <tr>
                <td><strong>${esc(i.p)}</strong></td>
                         <td>${esc(i.color)}</td>
                <td><span class="stock-pill ${i.q <= i.low ? "low" : ""}">${i.q}</span></td>
                <td><strong>${money(i.price)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `);
};

function findSaleProduct(s) {
  return s.product || "Sale";
}

// Keep the daily dashboard counters current even if the page remains open across midnight.
let dashboardDay = localToday();
setInterval(async () => {
  const newDay = localToday();
  if (newDay === dashboardDay) return;
  dashboardDay = newDay;

  if (!me || !supabaseReady()) return;

  try {
    await loadData();
    // Historical data is never cleared. Only the dashboard's "today" counters change.
    if (document.querySelector(".dashboard-page")) {
      renderDashboard();
    }
  } catch (err) {
    console.error("Daily sales refresh failed:", err);
  }
}, 30000);

/*
 * Supabase client bootstrap.
 * The page waits for this script before allowing username login.
 */
(function loadSupabase() {
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  s.onload = () => {
    if (window.supabase && SUPABASE_URL !== "YOUR_SUPABASE_URL" &&
        SUPABASE_PUBLISHABLE_KEY !== "YOUR_SUPABASE_ANON_KEY") {
      supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );
    }
    try {
      me = JSON.parse(sessionStorage.getItem("me") || "null");
    } catch {
      me = null;
    }

    if (me && supabaseClient) {
      loadData()
        .then(() => home("dashboard"))
        .catch(err => {
          console.error(err);
          sessionStorage.removeItem("me");
          me = null;
          login();
        });
    } else {
      login();
    }
  };
  s.onerror = () => {
    console.error("Could not load Supabase client.");
    login();
  };
  document.head.appendChild(s);
})();
