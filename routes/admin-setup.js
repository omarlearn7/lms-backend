const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

const SETUP_KEY = process.env.ADMIN_SETUP_KEY;

router.post('/', async (req, res) => {
  try {
    const { setupKey, email, password, firstName, lastName } = req.body;

    if (!SETUP_KEY) {
      return res.status(500).json({ error: 'Admin setup is not configured on this server.' });
    }

    if (setupKey !== SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key.' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName || 'Admin',
        last_name: lastName || 'User',
        role: 'admin'
      }
    });

    if (authError) {
      console.error('Supabase auth error during admin setup:', authError);
      return res.status(400).json({ error: authError.message });
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert([{
        id: authData.user.id,
        role: 'admin',
        first_name: firstName || 'Admin',
        last_name: lastName || 'User',
        subscription_active: true
      }]);

    if (profileError) {
      console.error('Profile creation error:', profileError);
    }

    res.status(201).json({
      message: 'Admin account created successfully.',
      userId: authData.user.id,
      email: authData.user.email
    });
  } catch (err) {
    console.error('Admin setup error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
