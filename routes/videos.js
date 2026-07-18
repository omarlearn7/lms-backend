const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/supabase');

/**
 * Server-Side Render Token Gating: 
 * Protects video iframe details based on subscription status.
 */
router.get('/:lessonId', requireAuth, async (req, res) => {
    try {
        const { lessonId } = req.params;
        const userId = req.user.id;

        // 1. Check user profile for subscription status
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('subscription_active, role')
            .eq('id', userId)
            .single();

        if (profileError || !profile) {
            return res.status(403).json({ error: 'Access denied: Profile not found' });
        }

        // Only active subscribers, teachers, and admins can watch videos
        const isAuthorized = profile.subscription_active || profile.role === 'admin' || profile.role === 'teacher';
        
        if (!isAuthorized) {
            // Stripping out iframe components entirely (returning 403)
            return res.status(403).json({ 
                error: 'Forbidden: Subscription required to access this lesson.' 
            });
        }

        // 2. Fetch the video details from DB (this contains the unlisted YouTube ID)
        const { data: video, error: videoError } = await supabase
            .from('videos')
            .select('youtube_video_id, title')
            .eq('id', lessonId)
            .single();

        if (videoError || !video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        // Return the raw ID, the frontend will inject it into a heavily restricted iframe
        res.json({
            videoId: video.youtube_video_id,
            title: video.title
        });

    } catch (error) {
        console.error('Error fetching video:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
