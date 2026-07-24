const { createClient } = require('@supabase/supabase-js');

let supabaseUrl = process.env.SUPABASE_URL || '';
try {
  if (supabaseUrl) {
    supabaseUrl = new URL(supabaseUrl).origin;
  }
} catch (err) {
  console.error('Error parsing SUPABASE_URL:', err);
}

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;

