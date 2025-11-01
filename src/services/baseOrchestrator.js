const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const CommunicationService = require('./communicationService');
const SchedulingAgent = require('./schedulingAgent');

/**
 * Base Orchestrator Class
 * Contains common functions shared across all journey orchestrators
 */
class BaseOrchestrator {
    constructor(intentData, geminiService, hospitalService) {
        this.intentData = intentData;
        this.geminiService = geminiService;
        this.hospitalService = hospitalService;
        this.communicationService = new CommunicationService();
        this.schedulingAgent = new SchedulingAgent(geminiService, this);
        this.policyInfo = null;
        this.loadPolicyInfo();
    }

    /**
     * Load policy information for personalization
     */
    loadPolicyInfo() {
        try {
            const policyPath = path.join(__dirname, '../../data/policyInfo.json');
            this.policyInfo = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
            console.log('Policy info loaded for orchestrator');
        } catch (error) {
            console.error('Error loading policy info:', error);
            this.policyInfo = null;
        }
    }

    /**
     * Get system prompts - common across all orchestrators
     */
    getSystemPrompts() {
        return `**Your RULES:**

1. **Role & Tone:** You are a Proactive TATA AIG Health Insurance ${this.intentData.brand_voice?.persona || 'Concierge AI'}. Be professional, empathetic, and supportive. Prioritize clarity and conciseness. Acknowledge the user's message before transitioning to the next step. Assume the user may be stressed and avoid overly formal language. Never greet again after the first message in a session.
2. **Formatting:** All responses must be formatted for WhatsApp. Use *bold* for key names or action items. Use line breaks (\\n) to improve readability.
3. **Emoji Usage:** Use 1-2 relevant emojis sparingly when they add warmth or clarity (e.g., 🏥 for hospitals, ✅ for confirmation, 📋 for forms, 💰 for costs 👋 for greetings). Avoid overuse - emojis should enhance, not distract from the message. these emojis are just for refrence
4. **Policy Data:** Whenever possible, use the *actual names* of family members (Vineet, Punita, Aradhya, Akshat) instead of generic roles (e.g., use 'Punita' instead of 'your wife').
5. **Process Focus:** Always guide the customer to the immediate next required step in the TATA AIG process. Do not jump ahead or discuss steps not yet relevant.
6. **Conversation History:** If we have recent conversation history, use it to understand context and references (like "this process", "that", "it", etc.).
7. DON'T repeat questions already answered above. DON'T greet again (only greet in first message). Use info from history (who, what, where mentioned)`;
    }

    /**
     * Send WhatsApp message asynchronously
     * Uses the communicationService.sendMessage() which handles all payload construction
     */
    async sendWhatsAppMessage(message) {
        try {
            // Replace \n with actual newlines for WhatsApp formatting
            const formattedMessage = message.replace(/\\n/g, '\n');
            
            // Fire and forget - don't wait for response
            // communicationService.sendMessage() handles all payload construction
            this.communicationService.sendMessage(formattedMessage).catch(error => {
                console.error('WhatsApp message failed:', error);
            });
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
        }
    }

    /**
     * Extract data from customer message using common patterns
     */
    extractDataFromMessage(message, collectedData, contextPayload = {}) {
        const extractedData = {};
        const messageLower = message.toLowerCase();

        // Common data extraction patterns
        if (messageLower.includes('yes') || messageLower.includes('sure') || messageLower.includes('okay') || messageLower.includes('ok')) {
            extractedData.confirmation = 'yes';
        } else if (messageLower.includes('no') || messageLower.includes('not interested') || messageLower.includes('decline')) {
            extractedData.confirmation = 'no';
        }

        // Date extraction
        const datePatterns = [
            /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
            /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
            /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
            /(\d{1,2})-(\d{1,2})-(\d{4})/
        ];

        for (const pattern of datePatterns) {
            const match = message.match(pattern);
            if (match) {
                extractedData.date = match[0];
                break;
            }
        }

        // Time extraction
        const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i;
        const timeMatch = message.match(timePattern);
        if (timeMatch) {
            extractedData.time = timeMatch[0];
        }

        // Cost extraction
        const costPattern = /(?:₹|rs\.?|rupees?)\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i;
        const costMatch = message.match(costPattern);
        if (costMatch) {
            extractedData.cost = costMatch[1];
        }

        return extractedData;
    }

    /**
     * Check if response is positive
     */
    // isPositiveResponse(message) {
    //     const positiveKeywords = ['yes', 'sure', 'okay', 'ok', 'yep', 'yeah', 'absolutely', 'definitely', 'of course'];
    //     const messageLower = message.toLowerCase();
    //     return positiveKeywords.some(keyword => messageLower.includes(keyword));
    // }
     isPositiveResponse(message = "") {
        if (typeof message !== "string" || message.trim().length < 1) return false;
      
        const text = message.toLowerCase().trim();
      
        // English + Hinglish + Hindi positive cues
        const positiveKeywords = [
          // English
          "yes", "yep", "yeah", "ok", "okay", "sure", "absolutely", "definitely",
          "of course", "fine", "alright", "sounds good", "go ahead", "please do",
          "confirmed", "accepted", "done", "great", "perfect",
      
          // Hinglish/Hindi (Roman)
          "haan", "ha", "hanji", "haaji", "bilkul", "thik hai", "theek hai",
          "sahi hai", "ho jaega", "ho jayega", "ho gya", "ho gaya", "kar do",
          "karo", "hoga", "chalo", "theek", "accha hai", "acha hai", "karlo",
          "kar lena", "kar dijiye", "kr dijiye", "krdo", "sure haan", "haan ok",
      
        ];
      
        // Faster match with whole-word detection
        const positiveRegex = new RegExp(`\\b(${positiveKeywords.join("|")})\\b`, "i");
      
        return positiveRegex.test(text);
      }
      

    /**
     * Check if response is negative
     */
    // isNegativeResponse(message) {
    //     const negativeKeywords = ['no', 'not interested', 'decline', 'cancel', 'not now', 'later'];
    //     const messageLower = message.toLowerCase();
    //     return negativeKeywords.some(keyword => messageLower.includes(keyword));
    // }
     isNegativeResponse(message = "") {
        if (typeof message !== "string" || message.trim().length < 1) return false;
      
        const text = message.toLowerCase().trim();
      
        // English + Hinglish + Hindi negative expressions
        const negativeKeywords = [
          // English
          "no", "not interested", "don't want", "do not want", "decline",
          "cancel", "stop", "later", "not now", "maybe later", "skip", "reject",
          "nah", "never", "don't call", "not required", "no thanks", "no thank you",
      
          // Hinglish / Roman Hindi
          "nahi", "nahi chahiye", "mat karo", "mat karna", "nahi karna",
          "baad mein", "abhi nahi", "nahi chahta", "nahi chahi", "mana hai",
          "rehne do", "chod do", "chhodo", "cancel karo", "cancel kar do",
          "ruko", "ruk jao", "baad me", "nahi lena", "nahi karwana", "mat bhejna",
          "mat kar do", "mat bhejo", "nahi bhai", "nahi madam", "nahi sir",
      
        ];
      
        // Word-boundary regex for fast + safe detection
        const negativeRegex = new RegExp(`\\b(${negativeKeywords.join("|")})\\b`, "i");
      
        return negativeRegex.test(text);
      }
      
    /**
     * Parse date for various formats
     */
    parseDateForClaim(dateString) {
        if (!dateString) return null;

        const monthNames = {
            'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
            'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
            'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
            'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
        };

        // Try different date formats
        const patterns = [
            /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)/i,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
            /(\d{1,2})-(\d{1,2})-(\d{4})/
        ];

        for (const pattern of patterns) {
            const match = dateString.match(pattern);
            if (match) {
                if (pattern.source.includes('jan|feb')) {
                    // Month name format
                    const day = parseInt(match[1]);
                    const monthName = match[2].toLowerCase();
                    const month = monthNames[monthName];
                    const currentYear = new Date().getFullYear();
                    const date = new Date(currentYear, month, day);
                    
                    // If date is in the past, assume next year
                    if (date < new Date()) {
                        date.setFullYear(currentYear + 1);
                    }
                    
                    return date.toISOString().split('T')[0];
                } else {
                    // Numeric format
                    const [, part1, part2, part3] = match;
                    const day = parseInt(part1);
                    const month = parseInt(part2) - 1; // JavaScript months are 0-indexed
                    const year = parseInt(part3);
                    
                    const date = new Date(year, month, day);
                    return date.toISOString().split('T')[0];
                }
            }
        }

        return null;
    }

    /**
     * Generate conversation ID for tracking
     */
    generateConversationId() {
        return uuidv4();
    }

    /**
     * Log conversation state for debugging
     */
    logConversationState(conversationId, stage, collectedData) {
        console.log(`\n📊 Conversation State [${conversationId}]:`);
        console.log(`   Current Stage: ${stage}`);
        console.log(`   Collected Data:`, collectedData);
    }
    detectLanguage(message) {
        if (!message || typeof message !== "string") return "English";
      
        const text = message.toLowerCase().trim();
        if (text.length < 2) return "English";
      
        const hindiHints = [
          // Core verbs & auxiliaries
          "hai", "ho", "haan", "nahi", "na", "kar", "karo", "karna", "karlo",
          "karle", "kardo", "krdo", "krle", "krna", "kariye", "kijiye",
          "theek", "thik", "accha", "acha", "bahut", "bhi", "abhi", "kal",
          "aaj", "parso", "chahiye", "zarurat", "lekin", "kyunki", "kyon",
          "kaise", "kaun", "kya", "kab", "kis", "kisne", "kyu", "kyun",
          "ko", "ki", "ke", "se", "mein", "me", "par", "pe", "tha", "thi",
          "hoga", "hogi", "honge", "hoti", "hote", "raha", "rahe", "rha",
          // Pronouns & possessives
          "main", "mai", "meri", "mera", "mere", "tera", "teri", "tumhara",
          "apna", "apni", "apne", "hum", "hamare", "humara", "aap", "aapka", "aapki", "aapke",
          "tum", "mujhe", "mujhko", "tumhe", "aapko", "unko", "unka", "unki", "unke",
          // Common conversational
          "sab", "kuch", "thoda", "zyada", "kam", "fir", "phir", "mat",
          "batao", "bataye", "bolo", "sun", "suno", "suna",
          // Relationships and family
          "papa", "mummy", "maa", "mata", "pita", "bhai", "behen", "beta", "beti", "bhaiya", "didi",
          // Politeness & fillers
          "sir", "madam", "madamji", "bhai sahab", "sahi", "galat", "acha", "theek", "ji", "haanji", "nahiji",
          // Actions
          "karwana", "karwado", "karwalo", "karenge", "krdenge", "krdijiye",
          "hoga na", "ho na", "hai na", "karoge", "karungi", "karunga"
        ];
      
        const hindiRegex = new RegExp(`\\b(${hindiHints.join("|")})\\b`, "i");
      
        // Bonus: detect actual Devanagari Hindi (Unicode range)
        const devanagariRegex = /[\u0900-\u097F]/;
      
        if (devanagariRegex.test(text) || hindiRegex.test(text)) return "Hindi";
        return "English";
      }
      
      
      
}

module.exports = BaseOrchestrator;
