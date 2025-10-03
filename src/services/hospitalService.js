const fs = require('fs');
const path = require('path');

class HospitalService {
  constructor() {
    this.hospitals = [];
    this.loadHospitalData();
  }

  /**
   * Load hospital data from JSON file
   */
  loadHospitalData() {
    try {
      const filePath = path.join(__dirname, '../../data/HospitalData.json');
      const data = fs.readFileSync(filePath, 'utf8');
      this.hospitals = JSON.parse(data);
      console.log(`Loaded ${this.hospitals.length} hospitals from Mumbai`);
    } catch (error) {
      console.error('Error loading hospital data:', error);
      this.hospitals = [];
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   * @param {number} lat1 - Latitude 1
   * @param {number} lon1 - Longitude 1
   * @param {number} lat2 - Latitude 2
   * @param {number} lon2 - Longitude 2
   * @returns {number} - Distance in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   * @param {number} degrees 
   * @returns {number}
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Find hospitals near a location
   * @param {number} latitude - User's latitude
   * @param {number} longitude - User's longitude
   * @param {number} radiusKm - Search radius in kilometers (default: 10)
   * @param {number} limit - Maximum number of results (default: 10)
   * @returns {Array} - Array of nearby hospitals with distance
   */
  findNearbyHospitals(latitude, longitude, radiusKm = 10, limit = 10) {
    if (!latitude || !longitude) {
      return [];
    }

    const nearbyHospitals = this.hospitals
      .map(hospital => {
        const distance = this.calculateDistance(
          latitude, 
          longitude, 
          parseFloat(hospital.latitude), 
          parseFloat(hospital.longitude)
        );
        
        return {
          ...hospital,
          distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
        };
      })
      .filter(hospital => hospital.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);

    return nearbyHospitals;
  }

  /**
   * Search hospitals by name or area
   * @param {string} searchTerm - Search term for hospital name or area
   * @param {number} limit - Maximum number of results (default: 10)
   * @returns {Array} - Array of matching hospitals
   */
  searchHospitals(searchTerm, limit = 10) {
    if (!searchTerm) {
      return [];
    }

    const searchLower = searchTerm.toLowerCase();
    
    const matchingHospitals = this.hospitals
      .filter(hospital => {
        return (
          hospital.hospitalName.toLowerCase().includes(searchLower) ||
          hospital.hospitalAddress.toLowerCase().includes(searchLower) ||
          hospital.zone.toLowerCase().includes(searchLower) ||
          hospital.pincode.includes(searchTerm)
        );
      })
      .slice(0, limit);

    return matchingHospitals;
  }

  /**
   * Get hospitals by network type
   * @param {string} networkType - Network type (e.g., "Valued", "Preferred")
   * @param {number} limit - Maximum number of results (default: 20)
   * @returns {Array} - Array of hospitals in the network
   */
  getHospitalsByNetwork(networkType, limit = 20) {
    if (!networkType) {
      return [];
    }

    return this.hospitals
      .filter(hospital => 
        hospital.networkType && 
        hospital.networkType.toLowerCase() === networkType.toLowerCase()
      )
      .slice(0, limit);
  }

  /**
   * Get hospitals by zone/area
   * @param {string} zone - Zone (e.g., "West", "East", "North", "South")
   * @param {number} limit - Maximum number of results (default: 20)
   * @returns {Array} - Array of hospitals in the zone
   */
  getHospitalsByZone(zone, limit = 20) {
    if (!zone) {
      return [];
    }

    return this.hospitals
      .filter(hospital => 
        hospital.zone && 
        hospital.zone.toLowerCase() === zone.toLowerCase()
      )
      .slice(0, limit);
  }

  /**
   * Get hospitals by pincode area
   * @param {string} pincode - Pincode or partial pincode
   * @param {number} limit - Maximum number of results (default: 15)
   * @returns {Array} - Array of hospitals in the pincode area
   */
  getHospitalsByPincode(pincode, limit = 15) {
    if (!pincode) {
      return [];
    }

    return this.hospitals
      .filter(hospital => 
        hospital.pincode && 
        hospital.pincode.startsWith(pincode.toString())
      )
      .slice(0, limit);
  }

  /**
   * Get emergency hospitals (all network hospitals for emergency coverage)
   * @param {number} latitude - User's latitude (optional)
   * @param {number} longitude - User's longitude (optional)
   * @param {number} limit - Maximum number of results (default: 15)
   * @returns {Array} - Array of emergency-accessible hospitals
   */
  getEmergencyHospitals(latitude = null, longitude = null, limit = 15) {
    let emergencyHospitals = this.hospitals.filter(hospital => hospital.networkType);

    // If location provided, sort by distance
    if (latitude && longitude) {
      emergencyHospitals = emergencyHospitals
        .map(hospital => {
          const distance = this.calculateDistance(
            latitude, 
            longitude, 
            parseFloat(hospital.latitude), 
            parseFloat(hospital.longitude)
          );
          
          return {
            ...hospital,
            distance: Math.round(distance * 100) / 100
          };
        })
        .sort((a, b) => a.distance - b.distance);
    }

    return emergencyHospitals.slice(0, limit);
  }

  /**
   * Format hospital information for display
   * @param {Array} hospitals - Array of hospital objects
   * @param {boolean} includeDistance - Whether to include distance in formatting
   * @returns {string} - Formatted hospital list
   */
  formatHospitalList(hospitals, includeDistance = false) {
    if (!hospitals || hospitals.length === 0) {
      return 'No hospitals found matching your criteria.';
    }

    let formattedList = `Here are ${hospitals.length} hospital${hospitals.length > 1 ? 's' : ''} for you:\n\n`;
    
    hospitals.forEach((hospital, index) => {
      formattedList += `**${index + 1}. ${hospital.hospitalName}**\n`;
      formattedList += `📍 ${hospital.hospitalAddress}\n`;
      formattedList += `📞 Pincode: ${hospital.pincode}\n`;
      formattedList += `🏥 Network: ${hospital.networkType || 'Standard'}\n`;
      formattedList += `🗺️ Zone: ${hospital.zone}\n`;
      
      if (includeDistance && hospital.distance !== undefined) {
        formattedList += `📏 Distance: ${hospital.distance} km\n`;
      }
      
      formattedList += '\n';
    });

    return formattedList;
  }

  /**
   * Get comprehensive hospital recommendations based on query type
   * @param {string} queryType - Type of query (emergency, checkup, nearby, network)
   * @param {Object} options - Search options (location, area, networkType, etc.)
   * @returns {Object} - Formatted hospital recommendations
   */
  getHospitalRecommendations(queryType, options = {}) {
    let hospitals = [];
    let title = '';
    let includeDistance = false;

    switch (queryType.toLowerCase()) {
      case 'emergency':
        hospitals = this.getEmergencyHospitals(
          options.latitude, 
          options.longitude, 
          options.limit || 10
        );
        title = 'Emergency Hospitals';
        includeDistance = !!(options.latitude && options.longitude);
        break;

      case 'nearby':
        if (options.latitude && options.longitude) {
          hospitals = this.findNearbyHospitals(
            options.latitude, 
            options.longitude, 
            options.radius || 10, 
            options.limit || 10
          );
          title = `Nearby Hospitals (within ${options.radius || 10} km)`;
          includeDistance = true;
        }
        break;

      case 'network':
        hospitals = this.getHospitalsByNetwork(
          options.networkType || 'Valued', 
          options.limit || 15
        );
        title = `${options.networkType || 'Valued'} Network Hospitals`;
        break;

      case 'area':
      case 'zone':
        if (options.zone) {
          hospitals = this.getHospitalsByZone(options.zone, options.limit || 15);
          title = `Hospitals in ${options.zone} Mumbai`;
        } else if (options.pincode) {
          hospitals = this.getHospitalsByPincode(options.pincode, options.limit || 15);
          title = `Hospitals near Pincode ${options.pincode}`;
        }
        break;

      case 'search':
        if (options.searchTerm) {
          hospitals = this.searchHospitals(options.searchTerm, options.limit || 10);
          title = `Search Results for "${options.searchTerm}"`;
        }
        break;

      default:
        hospitals = this.hospitals.slice(0, 10);
        title = 'Available Hospitals';
    }

    return {
      title,
      hospitals,
      formattedList: this.formatHospitalList(hospitals, includeDistance),
      count: hospitals.length,
      isAvailable: hospitals.length > 0
    };
  }

  /**
   * Check if hospital data is loaded
   * @returns {boolean}
   */
  isDataAvailable() {
    return this.hospitals && this.hospitals.length > 0;
  }

  /**
   * Get total hospital count
   * @returns {number}
   */
  getTotalHospitalCount() {
    return this.hospitals.length;
  }

  /**
   * Get available network types
   * @returns {Array}
   */
  getNetworkTypes() {
    const networkTypes = [...new Set(this.hospitals.map(h => h.networkType).filter(Boolean))];
    return networkTypes;
  }

  /**
   * Get available zones
   * @returns {Array}
   */
  getZones() {
    const zones = [...new Set(this.hospitals.map(h => h.zone).filter(Boolean))];
    return zones;
  }
}

module.exports = HospitalService;
