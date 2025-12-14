# EXAMPLE Configuration - Copy this to config.py and fill in your values
# DO NOT commit config.py to Git!

# Configuration Gmail
GMAIL_EMAIL = "your.email@gmail.com"  # Your Gmail address
GMAIL_APP_PASSWORD = "xxxx xxxx xxxx xxxx"  # App password from Gmail (16 chars)

# Configuration Telegram
TELEGRAM_BOT_TOKEN = "1234567890:ABCdefGHI..."  # Get from @BotFather
TELEGRAM_CHAT_ID = "123456789"  # Your Telegram Chat ID

# Configuration Groq AI (Optional - for intelligent classification)
# Get free API key from https://console.groq.com
GROQ_API_KEY = ""  # Leave empty to disable AI
USE_AI_CLASSIFICATION = False  # Set to True to enable AI

# Configuration
CHECK_INTERVAL_HOURS = 4  # How often to check emails (1-24 hours)
IMAP_SERVER = "imap.gmail.com"
IMAP_PORT = 993

# Smart filtering - Customize these lists
ALWAYS_IGNORE_DOMAINS = [
    'pinterest.com',
    'discover.pinterest.com',
    'noreply',
    'no-reply',
    # Add your own domains to ignore
]

ALWAYS_IGNORE_KEYWORDS = [
    'unsubscribe',
    'newsletter',
    'promotion',
    'marketing',
    'discount',
    # Add your own keywords to ignore
]
