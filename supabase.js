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

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWNvYW5rZ3R2cGJ4aXJudmloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDM5ODcwOCwiZXhwIjoyMDk5OTc0NzA4fQ.gtjcvAIEqqNr0QHKrWUekNLQmNqNNp5idJsmU5RsLc0';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;

