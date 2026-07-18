const express = require('express');
const router = express.Router();
const { requireAuth, requireTeacherOrAdmin } = require('../middleware/supabase');
const { google } = require('googleapis');

// Scopes for YouTube Upload
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

// Initialize Google Auth with Service Account
const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: SCOPES,
});

/**
 * Request an OAuth token for client-side resumable upload.
 * Protected: Only authenticated teachers or admins can request this.
 */
router.post('/upload-token', requireAuth, requireTeacherOrAdmin, async (req, res) => {
    try {
        const client = await auth.getClient();
        // The service account token request
        const tokenResponse = await client.getAccessToken();
        
        if (!tokenResponse || !tokenResponse.token) {
            return res.status(500).json({ error: 'Failed to retrieve access token' });
        }

        res.json({ accessToken: tokenResponse.token });
    } catch (error) {
        console.error('Error fetching Google OAuth token:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
