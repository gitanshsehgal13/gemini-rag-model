const fs = require('fs');
const path = require('path');

class PolicyTimelineService {
  constructor() {
    this.timelineFilePath = path.join(__dirname, '../../data/policyTimeline.json');
  }

  /**
   * Load policy timeline data
   * @returns {Object} - Policy timeline data
   */
  loadTimelineData() {
    try {
      if (!fs.existsSync(this.timelineFilePath)) {
        return null;
      }
      
      const data = fs.readFileSync(this.timelineFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading policy timeline data:', error);
      return null;
    }
  }

  /**
   * Save policy timeline data
   * @param {Object} timelineData - Updated timeline data
   */
  saveTimelineData(timelineData) {
    try {
      fs.writeFileSync(this.timelineFilePath, JSON.stringify(timelineData, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving policy timeline data:', error);
      return false;
    }
  }

  /**
   * Find pending health checkup events
   * @returns {Array} - Array of pending health checkup events with their indices
   */
  findPendingHealthCheckups() {
    const timelineData = this.loadTimelineData();
    if (!timelineData || !timelineData.policyTimeline || !timelineData.policyTimeline.events) {
      return [];
    }

    const pendingCheckups = [];
    timelineData.policyTimeline.events.forEach((event, index) => {
      if ((event.status === 'Booked' || event.status === 'Pending') && 
          event.title.toLowerCase().includes('health checkup')) {
        pendingCheckups.push({
          ...event,
          eventIndex: index
        });
      }
    });

    return pendingCheckups;
  }

  /**
   * Reschedule a health checkup event
   * @param {string} newDate - New date for the health checkup (e.g., "25 Nov 2024")
   * @param {string} newTimeSlot - New time slot (e.g., "2 PM - 4 PM")
   * @returns {Object} - Result of the reschedule operation
   */
  rescheduleHealthCheckup(newDate, newTimeSlot = "9 AM - 11 AM") {
    const timelineData = this.loadTimelineData();
    if (!timelineData) {
      return {
        success: false,
        message: 'Unable to load policy timeline data'
      };
    }

    // Find the pending health checkup
    const pendingCheckups = this.findPendingHealthCheckups();
    if (pendingCheckups.length === 0) {
      return {
        success: false,
        message: 'No pending health checkup bookings found to reschedule'
      };
    }

    // Check slot availability - static case for November 23rd
    const slotAvailability = this.checkSlotAvailability(newDate);
    if (!slotAvailability.available) {
      return {
        success: false,
        message: slotAvailability.message,
        alternativeSlots: slotAvailability.alternativeSlots
      };
    }

    // Update the first pending health checkup (assuming one active booking)
    const checkupToUpdate = pendingCheckups[0];
    const eventIndex = checkupToUpdate.eventIndex;

    // Update the event
    timelineData.policyTimeline.events[eventIndex] = {
      ...timelineData.policyTimeline.events[eventIndex],
      date: newDate,
      details: `Great news, Vineet! Your health check-up has been rescheduled. Sample collection on ${this.getFormattedDate(newDate)} between ${newTimeSlot}.`,
      tag: "1 of 3 Available" // Keep the same tag
    };

    // Save the updated data
    const saveSuccess = this.saveTimelineData(timelineData);
    
    if (saveSuccess) {
      return {
        success: true,
        message: `Health checkup successfully rescheduled to ${newDate} (${newTimeSlot})`,
        updatedEvent: timelineData.policyTimeline.events[eventIndex],
        originalDate: checkupToUpdate.date,
        newDate: newDate
      };
    } else {
      return {
        success: false,
        message: 'Failed to save rescheduled appointment'
      };
    }
  }

  /**
   * Check slot availability for a given date
   * @param {string} date - Date string (e.g., "23 Nov 2025")
   * @returns {Object} - Availability status and alternatives
   */
  checkSlotAvailability(date) {
    // Normalize date for comparison
    const normalizedDate = date.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Static case: November 23rd is not available
    const unavailableDates = [
      '23 nov 2025',
      '23 november 2025',
      'nov 23 2025',
      'november 23 2025',
      '23rd nov 2025',
      '23rd november 2025'
    ];
    
    const isUnavailable = unavailableDates.some(unavailableDate => 
      normalizedDate === unavailableDate
    );
    
    if (isUnavailable) {
      return {
        available: false,
        message: 'Sorry, the requested date (November 23rd) is not available for health checkup appointments.',
        alternativeSlots: [
          {
            date: '21 Nov 2025',
            timeSlots: ['9 AM - 11 AM', '2 PM - 4 PM', '5 PM - 7 PM']
          },
          {
            date: '24 Nov 2025', 
            timeSlots: ['9 AM - 11 AM', '11 AM - 1 PM', '3 PM - 5 PM']
          }
        ]
      };
    }
    
    // All other dates are available
    return {
      available: true,
      message: 'Date is available for booking'
    };
  }

  /**
   * Helper method to format date for details message
   * @param {string} dateString - Date string (e.g., "25 Nov 2024")
   * @returns {string} - Formatted date for message
   */
  getFormattedDate(dateString) {
    // Extract day from the date string for ordinal formatting
    const dayMatch = dateString.match(/^(\d+)/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1]);
      const ordinal = this.getOrdinal(day);
      return dateString.replace(/^(\d+)/, `${day}${ordinal}`);
    }
    return dateString;
  }

  /**
   * Get ordinal suffix for a day
   * @param {number} day - Day number
   * @returns {string} - Ordinal suffix (st, nd, rd, th)
   */
  getOrdinal(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  /**
   * Parse reschedule request to extract new date and time
   * @param {string} query - User's reschedule request
   * @returns {Object} - Parsed date and time information
   */
  parseRescheduleRequest(query) {
    const lowerQuery = query.toLowerCase();
    
    // Date patterns
    const datePatterns = [
      // "25th Nov", "25th November", "25 Nov", "25 November"
      /(\d{1,2})(?:st|nd|rd|th)?\s+(nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october)/i,
      // "Nov 25", "November 25th"
      /(nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
      // "tomorrow", "next week", "next month"
      /(tomorrow|next\s+week|next\s+month|next\s+\w+day)/i,
      // Handle follow-up responses like "yes 21 november"
      /^(yes|yeah|yep|ok|okay)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october)/i,
      /^(yes|yeah|yep|ok|okay)\s+(nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october)\s+(\d{1,2})(?:st|nd|rd|th)?/i
    ];

    // Time patterns
    const timePatterns = [
      // "2 PM", "10 AM", "2:30 PM"
      /(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
      // "morning", "afternoon", "evening"
      /(morning|afternoon|evening)/i
    ];

    let extractedDate = null;
    let extractedTime = null;

    // Extract date
    for (const pattern of datePatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        if (match[0].includes('tomorrow')) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          extractedDate = tomorrow.toLocaleDateString('en-GB', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
          });
        } else if (match[0].includes('next week')) {
          const nextWeek = new Date();
          nextWeek.setDate(nextWeek.getDate() + 7);
          extractedDate = nextWeek.toLocaleDateString('en-GB', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
          });
        } else {
          // For specific dates like "25 Nov" or "Nov 25" or "yes 21 november"
          let dateMatch = match[0];
          // Remove "yes", "ok", etc. from the beginning
          dateMatch = dateMatch.replace(/^(yes|yeah|yep|ok|okay)\s+/i, '');
          extractedDate = this.normalizeDate(dateMatch);
        }
        break;
      }
    }

    // Extract time
    for (const pattern of timePatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        if (match[0].includes('morning')) {
          extractedTime = '9 AM - 11 AM';
        } else if (match[0].includes('afternoon')) {
          extractedTime = '2 PM - 4 PM';
        } else if (match[0].includes('evening')) {
          extractedTime = '5 PM - 7 PM';
        } else {
          // Specific time like "2 PM"
          extractedTime = this.normalizeTime(match[0]);
        }
        break;
      }
    }

    return {
      date: extractedDate,
      time: extractedTime || '9 AM - 11 AM' // default time slot
    };
  }

  /**
   * Normalize date format
   * @param {string} dateStr - Raw date string
   * @returns {string} - Normalized date (e.g., "25 Nov 2024")
   */
  normalizeDate(dateStr) {
    // Add current year if not present
    const currentYear = new Date().getFullYear();
    const hasYear = dateStr.match(/\d{4}/);
    
    // Clean up ordinal suffixes (st, nd, rd, th)
    let cleanDate = dateStr.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1');
    
    if (!hasYear) {
      return `${cleanDate.trim()} ${currentYear}`;
    }
    
    return cleanDate.trim();
  }

  /**
   * Normalize time format
   * @param {string} timeStr - Raw time string
   * @returns {string} - Normalized time slot (e.g., "2 PM - 4 PM")
   */
  normalizeTime(timeStr) {
    const cleanTime = timeStr.trim().toUpperCase();
    
    // If it's a single time, create a 2-hour slot
    if (!cleanTime.includes('-')) {
      const hour = parseInt(cleanTime);
      const isPM = cleanTime.includes('PM');
      const nextHour = hour + 2;
      
      if (isPM) {
        return `${hour} PM - ${nextHour > 12 ? nextHour - 12 : nextHour} PM`;
      } else {
        return `${hour} AM - ${nextHour} AM`;
      }
    }
    
    return cleanTime;
  }

  /**
   * Check if a query is a reschedule request
   * @param {string} query - User's query
   * @returns {boolean} - Whether it's a reschedule request
   */
  isRescheduleRequest(query) {
    const lowerQuery = query.toLowerCase();
    
    const rescheduleKeywords = [
      'reschedule',
      'rescheduled', // past tense
      'resheduled',  // common typo
      'reshudule',   // common typo
      'postpone',
      'change date',
      'change time',
      'move appointment',
      'different date',
      'different time',
      'another day',
      'another time',
      'later date',
      'earlier date',
      'change to',
      'move to',
      'shift to',
      'update to'
    ];

    const healthCheckupKeywords = [
      'health checkup',
      'health check-up',
      'checkup',
      'check-up',
      'appointment',
      'booking',
      'test',
      'screening',
      'my checkup',
      'my appointment',
      'my booking',
      'my health checkup'
    ];

    const hasRescheduleKeyword = rescheduleKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );

    const hasHealthKeyword = healthCheckupKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );

    // If it has reschedule keywords and health keywords, it's definitely a reschedule
    if (hasRescheduleKeyword && hasHealthKeyword) {
      return true;
    }

    // If it has reschedule keyword and mentions dates, it's likely a reschedule
    // (assuming context from previous conversation about health checkups)
    if (hasRescheduleKeyword && this.hasDateMentions(lowerQuery)) {
      return true;
    }

    // Handle follow-up responses like "yes 21 november" after offering alternatives
    const isFollowUpReschedule = /^(yes|yeah|yep|ok|okay)\s+(.*(?:nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october).*)/i.test(lowerQuery);
    if (isFollowUpReschedule) {
      return true;
    }

    return false;
  }

  /**
   * Check if query mentions dates
   * @param {string} query - Lowercase query
   * @returns {boolean} - Whether the query mentions dates
   */
  hasDateMentions(query) {
    const dateKeywords = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
      'tomorrow', 'today', 'next week', 'next month',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    ];

    return dateKeywords.some(keyword => query.includes(keyword)) ||
           /\d{1,2}(st|nd|rd|th)?\s+/.test(query); // Pattern like "25th ", "1st ", etc.
  }
}

module.exports = PolicyTimelineService;
