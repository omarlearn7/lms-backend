// scripts/seed-dzd-products.js
// Idempotent seed of the DZD-anchored subscription plans (mirrors migration 23).
// Run: node scripts/seed-dzd-products.js
// Uses the service-role client, so it bypasses RLS.
require('dotenv').config();
const supabase = require('../supabase');

const PLANS = [
  { title: 'اشتراك شهري - شهر واحد', dzd: 1500, usdt: 6.17, days: 30, ord: 1 },
  { title: 'اشتراك 3+1 أشهر', dzd: 4500, usdt: 18.51, days: 120, ord: 2 },
  { title: 'اشتراك 6+2 أشهر', dzd: 8000, usdt: 32.91, days: 240, ord: 3 },
];

(async () => {
  for (const p of PLANS) {
    const { data: existing, error: findErr } = await supabase
      .from('products')
      .select('id')
      .eq('title', p.title)
      .maybeSingle();

    if (findErr) throw new Error(`find ${p.title}: ${findErr.message}`);

    const row = {
      title: p.title,
      type: 'subscription',
      duration_days: p.days,
      base_price: p.usdt,
      base_price_dzd: p.dzd,
      is_active: true,
      sort_order: p.ord,
      discount_2nd_pct: 20,
      discount_3rd_pct: 40,
      max_family_size: 3,
    };

    let result;
    if (existing) {
      result = await supabase.from('products').update(row).eq('id', existing.id);
    } else {
      result = await supabase.from('products').insert([row]);
    }

    if (result.error) throw new Error(`upsert ${p.title}: ${result.error.message}`);
    console.log(existing ? 'UPDATED' : 'INSERTED', '-', p.title, `(${p.dzd} DA / ${p.usdt} USDT, ${p.days}d)`);
  }

  const { data: all, error: allErr } = await supabase
    .from('products')
    .select('title, base_price_dzd, base_price, duration_days, discount_2nd_pct, discount_3rd_pct, max_family_size, sort_order')
    .order('sort_order');

  if (allErr) throw new Error(allErr.message);
  console.log('\nAll products now in DB:');
  for (const r of all) {
    console.log('-', r.title, '| dzd:', r.base_price_dzd, '| usdt:', r.base_price, '| days:', r.duration_days, '| 2nd%:', r.discount_2nd_pct, '| fam:', r.max_family_size);
  }

  // Deactivate any legacy product without a DZD anchor so the UI only offers the DZD plans.
  const { data: legacy, error: legacyErr } = await supabase
    .from('products')
    .select('id, title')
    .or('base_price_dzd.is.null');

  if (legacyErr) throw new Error(legacyErr.message);
  if (legacy && legacy.length) {
    const { error: deactErr } = await supabase
      .from('products')
      .update({ is_active: false })
      .or('base_price_dzd.is.null');
    if (deactErr) throw new Error('deactivate legacy: ' + deactErr.message);
    console.log('\nDeactivated legacy (no DZD anchor):', legacy.map((p) => p.title).join(' | '));
  }
})().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
