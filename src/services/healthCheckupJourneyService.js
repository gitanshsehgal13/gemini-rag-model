const fs = require('fs-extra');
const path = require('path');
const HealthCheckupOrchestrator = require('./healthCheckupOrchestrator');

/**
 * Health Checkup Journey Service
 * Manages the HEALTH_CHECKUP_BOOKING_JOURNEY intent specifically
 */
class HealthCheckupJourneyService {
    constructor(geminiService, hospitalService) {
        this.geminiService = geminiService;
        this.hospitalService = hospitalService;
        this.intentData = null;
        this.customerJourneys = new Map(); // Store journey data by customerId (like claim event intent)
        this.conversationHistories = new Map(); // Store conversation histories by conversationId
        this.conversationStates = new Map(); // Store conversation state by conversationId
        this.orchestrator = null;
        this.loadHealthCheckupData();
    }

    /**
     * Load health checkup journey data
     */
    loadHealthCheckupData() {
        try {
            const healthCheckupPath = path.join(__dirname, '../../data/healthCheckupJourney.json');
            this.intentData = JSON.parse(fs.readFileSync(healthCheckupPath, 'utf8'));
            console.log(`Loaded health checkup journey data for intent: ${this.intentData.intent}`);
            
            // Initialize orchestrator
            this.orchestrator = new HealthCheckupOrchestrator(this.intentData, this.geminiService, this.hospitalService, this);
            console.log(`Initialized health checkup orchestrator`);
        } catch (error) {
            console.error('Error loading health checkup journey data:', error);
            this.intentData = null;
        }
    }

    /**
     * Process health checkup journey query
     */
    async processHealthCheckupQuery(customerId, query, options = {}) {
        try {
            console.log(`\n🏥 Processing Health Checkup Query for customer: ${customerId}`);
            console.log(`Query: "${query}"`);

            if (!this.orchestrator) {
                throw new Error('Health checkup orchestrator not initialized');
            }

            // Get or create journey data for this customer (similar to claim event intent)
            let journeyData = this.customerJourneys.get(customerId);
            if (!journeyData || journeyData.intent !== this.intentData.intent) {
                const conversationId = this.generateConversationId();
                journeyData = {
                    conversationId,
                    intent: this.intentData.intent,
                    customerId,
                    status: 'active',
                    startedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.customerJourneys.set(customerId, journeyData);
                this.conversationStates.set(conversationId, null);
                this.conversationHistories.set(conversationId, []);
                console.log(`✅ Started new health checkup journey with conversation ID: ${conversationId}`);
            }

            const conversationId = journeyData.conversationId;
            let conversationState = this.conversationStates.get(conversationId);
            let conversationHistory = this.conversationHistories.get(conversationId) || [];
            
            console.log(`📊 Health Checkup - Conversation ID: ${conversationId}`);
            console.log(`📊 Health Checkup - Existing history length: ${conversationHistory.length}`);
            console.log(`📊 Health Checkup - Existing state:`, conversationState ? conversationState.currentStageId : 'NEW');
            console.log(`📊 Health Checkup - Collected data:`, conversationState ? JSON.stringify(conversationState.collectedData, null, 2) : 'NONE');

            // Process the journey
            const result = await this.orchestrator.processHealthCheckupJourney(
                customerId,
                query,
                conversationHistory,
                conversationState
            );

            // Update stored state and history
            this.conversationStates.set(conversationId, result.conversationState);
            this.conversationHistories.set(conversationId, result.conversationHistory);
            
            console.log(`✅ Updated conversation state - New stage: ${result.conversationState?.currentStageId}`);
            console.log(`✅ Updated conversation history - New length: ${result.conversationHistory?.length}`);

            return {
                answer: result.answer,
                conversationId: result.conversationId,
                intent: this.intentData.intent,
                status: 'active',
                conversationHistory: result.conversationHistory,
                currentStage: result.conversationState?.currentStageId,
                collectedData: result.conversationState?.collectedData
            };

        } catch (error) {
            console.error('Error processing health checkup query:', error);
            throw error;
        }
    }

    /**
     * Generate conversation ID
     */
    generateConversationId() {
        return `health_checkup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get conversation history for a customer
     */
    getConversationHistory(conversationId) {
        return this.conversationHistories.get(conversationId) || [];
    }

    /**
     * Get conversation state for a customer
     */
    getConversationState(conversationId) {
        return this.conversationStates.get(conversationId) || null;
    }

    /**
     * Clear conversation data (for testing or cleanup)
     */
    clearConversationData(conversationId) {
        this.conversationHistories.delete(conversationId);
        this.conversationStates.delete(conversationId);
        console.log(`Cleared conversation data for: ${conversationId}`);
    }

    /**
     * Get intent data
     */
    getIntentData() {
        return this.intentData;
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.intentData !== null && this.orchestrator !== null;
    }
}

module.exports = HealthCheckupJourneyService;
