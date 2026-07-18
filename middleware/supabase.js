const supabase = require('../supabase');

const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error during authentication' });
    }
};

const requireTeacherOrAdmin = async (req, res, next) => {
    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', req.user.id)
            .single();

        if (error || !profile) {
            return res.status(403).json({ error: 'Profile not found' });
        }

        if (profile.role !== 'teacher' && profile.role !== 'admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error checking role' });
    }
};

module.exports = { requireAuth, requireTeacherOrAdmin };
