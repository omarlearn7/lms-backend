const { createClient } = require('@supabase/supabase-js');

let supabaseUrl = process.env.SUPABASE_URL || '';
// Sanitize URL if ending with /rest/v1 or trailing slashes
supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;

