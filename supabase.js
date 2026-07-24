const { createClient } = require('@supabase/supabase-js');

const rawUrl = process.env.SUPABASE_URL || 'https://yvucoankgtvpbxirnvih.supabase.co';
let supabaseUrl = 'https://yvucoankgtvpbxirnvih.supabase.co';

try {
  if (rawUrl) {
    supabaseUrl = new URL(rawUrl).origin;
  }
} catch (err) {
  console.error('Error parsing SUPABASE_URL, using default base URL:', err);
}

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '***REMOVED***';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;

