const axios = require('axios');

/**
 * Claim Initiation Service
 * Handles claim initiation API calls to Tata AIG
 */
class ClaimInitiationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://alpha10bn.tataaig.com/servicing/api/health/claims/initiate-claim';
    this.authToken = config.authToken || '12335a07ca8ed963ad73d7ceb150bef2:7c9de5fc80bb28900c1bff7696e8a5ad63f2bce938e4b9bde6c1e0f4788c822b3f651647061c8cc92a31ee1e6a4d8461390ad8df4f94318da6446c2f35d707ede75a06910a060d2b90b701e71f96beafceae02ea7b97d13639dc6d71a679c3abb224634eee5380f86731afbbfb30f599845478a88a4ad328f591e566306773bb5f9372ba55951ee7d19737f7633510b7f010297cb54aa404e9927fc7cf3895e91461d9afb3bd1e934bf877eca12e20eb9d055331ef2a8bfe81e1ba89e9190f3297115a1777de98434fce8f4e3431b6c4586a1463f7f1c0026d27510ff5ddf2ab141ce7b6562a840cdc608c296896ad32e8de5aead3bca9cd6d3784999f96adc7c1d0f0261c3e36dff457d9d6c7fc0566845130e1c7bdc2d56fee84ffe43d4604eefae07d949bb37bc86ecb26d1e89ac0b7da55f4526fcf913be3810de523560b6109e292c81d37de1cca183709152f2c5dc75d5f8853165872ecf5015d2e44eaf06eff266ceb0b1799105857ab726b3ba4adec3c7b1993777fcace37dccd5c3aa05643cf5a60544cda82106e22ffb02edd96c8b6fafae80e35ce78554a5e9361f039341d97720f0d111dfa1e5c9d3370a876242e00af9311c50a57cb20d6feef99a2c0d8dda377a3846cda4260e385dc734aac01ce8ff027aafa360b82dde0d361a182e57b3440bdfc9572395cef847fbfc9daf5108c4a09109a5c442d7104000f2adc2233deb982c694c2359a61088df6846efe7ccb5ce20609d86b60b4bfaee635d4379ab2120fae5c10c4588b79affe4e8deb3bb17a7d461592c3bd3d70eb9e9f5eca757c35768442dea468eb3adbeb53f16afb6c50c218170651f8ebb8b33b9758cc11941cef6ec5b91eec1371f05fb8986f913108d061fbf1591c8af78728e169a485f675ae3399a2a64fd6469380ffeb0f8e25b1c64c6d21e43e6c301e1200b845ab37af9a051314f8f99bd449';
  }

  /**
   * Initiate a claim
   * @param {Object} claimData - Claim data object
   * @returns {Promise<Object>} - API response
   */
  async initiateClaim(claimData) {
    const {
      // User inputs
      dateOfAdmission,
      diagnosis,
      estimatedCost,
      
      // Policy data
      policyNumber,
      memberFirstName,
      memberLastName,
      memberDob,
      memberGender,
      memberRelation,
      memberUHID,
      mobileNumber,
      emailId,
      communicationAddress,
      communicationCity,
      communicationPincode,
      
      // Hospital data (user selected)
      hospitalName,
      hospitalAddress,
      hospitalAddressLine2,
      hospitalCityTownVillage,
      hospitalDistrict,
      hospitalState,
      hospitalPincode,
      hospitalCountry
    } = claimData;

    // Calculate discharge date (admission date + 2 days)
    const dateOfDischarge = this.calculateDischargeDate(dateOfAdmission);

    // Build the payload
    const payload = {
      // Static fields
      benefitClaim: "false",
      certificateNumber: "",
      coverCode: "",
      estimatedDays: "2",
      hospitalEmailId: "",
      hospitalMobileNo: "",
      hospitalStatus: "PRN Generated",
      isCAG: true,
      isCashlessPayment: "Not Chosen",
      isCreatedFromClaimIntimation: "true",
      isExcludedProvider: "false",
      isExistingProvider: false,
      isHospitalManualEntry: "No",
      isPrePostClaim: false,
      policyDetailsProposerNameFirstName: "",
      policyDetailsProposerNameLastName: "",
      policyDetailsProposerNameMiddleName: "",
      policyTypeForClaim: "Retail",
      prn: "PRN1021142",
      producerAlternateEmail: "UATRETAILHEALTH@TATAAIG.COM",
      producerEmail: "",
      rohiniId: "8900080014039",
      secondOpinion: "false",
      source: "SPA",
      subSource: "MobileApp",
      tpaCode: "1000000023",
      typeOfClaim: "Cashless",
      utmCampaign: "",
      utmMedium: "",
      utmSource: "",
      
      // Dynamic fields from policy data
      communicationAddress: communicationAddress || "",
      communicationCity: communicationCity || "",
      communicationPincode: communicationPincode || "",
      emailId: emailId || "",
      memberDob: memberDob || "",
      memberFirstName: memberFirstName || "",
      memberGender: memberGender || "",
      memberLastName: memberLastName || "",
      memberRelation: memberRelation || "",
      memberUHID: memberUHID || "",
      mobileNumber: mobileNumber || "",
      policyNumber: policyNumber || "",
      
      // User input fields
      dateOfAdmission: dateOfAdmission || "",
      dateOfDischarge: dateOfDischarge || "",
      diagnosis: diagnosis || "",
      illness: diagnosis || "", // Same as diagnosis
      estimatedCost: estimatedCost || "",
      
      // Hospital data (user selected)
      hospitalAddress: hospitalAddress || "",
      hospitalAddressLine2: hospitalAddressLine2 || "",
      hospitalCityTownVillage: hospitalCityTownVillage || "",
      hospitalCountry: hospitalCountry || "INDIA",
      hospitalDistrict: hospitalDistrict || "",
      hospitalName: hospitalName || "",
      hospitalPincode: hospitalPincode || "",
      hospitalState: hospitalState || ""
    };

    console.log('Initiating claim with payload:', JSON.stringify(payload, null, 2));

    // Retry logic for network issues
    const maxRetries = 3;
    const retryDelay = 10000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Making API call (attempt ${attempt}/${maxRetries})...`);
        
        const response = await axios.post(this.apiEndpoint, payload, {
          headers: {
            'accept-version': '2.0.0',
            'Content-Type': 'application/json',
            'x-client': 'android',
            'platform': 'android',
            'X-App-Version': '4.1.2-debug',
            'x-build-number': '2025100802',
            'X-User-ID': '6703cfc70ad5a990e3d1f197',
            'Authorization': `Bearer ${this.authToken}`
          },
          timeout: 30000 // 30 second timeout
        });

        console.log('Claim initiated successfully:', response.data);
        return {
          success: true,
          data: response.data
        };

      } catch (error) {
        console.error(`Claim initiation attempt ${attempt} failed:`, error.response?.data || error.message);
        
        // Check if it's a retryable error
        const isRetryableError = 
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ENOTFOUND' ||   // DNS resolution failed
          error.code === 'ECONNREFUSED' || // Connection refused
          error.code === 'ETIMEDOUT' ||   // Connection timeout
          error.response?.status === 504 || // Gateway timeout
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503 || // Service unavailable
          (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('504 Gateway Timeout'));

        if (isRetryableError && attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Final attempt failed or non-retryable error
        console.error('Claim initiation failed after all retries:', error.response?.data || error.message);
        return {
          success: false,
          error: error.response?.data || { 
            message: error.message,
            code: error.code,
            status: error.response?.status
          }
        };
      }
    }
  }

  /**
   * Calculate discharge date (admission date + 2 days)
   * @param {string} admissionDate - Admission date in DD-MM-YYYY format
   * @returns {string} - Discharge date in DD-MM-YYYY format
   */
  calculateDischargeDate(admissionDate) {
    try {
      // Parse DD-MM-YYYY format
      const parts = admissionDate.split('-');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const year = parseInt(parts[2], 10);
      
      const date = new Date(year, month, day);
      
      // Add 2 days
      date.setDate(date.getDate() + 2);
      
      // Format back to DD-MM-YYYY
      const newDay = String(date.getDate()).padStart(2, '0');
      const newMonth = String(date.getMonth() + 1).padStart(2, '0');
      const newYear = date.getFullYear();
      
      return `${newDay}-${newMonth}-${newYear}`;
    } catch (error) {
      console.error('Error calculating discharge date:', error);
      return admissionDate; // Return original if error
    }
  }

  /**
   * Build claim data from policy info and user inputs
   * @param {Object} policyInfo - Policy information
   * @param {Object} userInputs - User provided inputs
   * @param {Object} hospitalData - Selected hospital data
   * @returns {Object} - Complete claim data object
   */
  buildClaimData(policyInfo, userInputs, hospitalData) {
    // Find the member who needs admission
    let member = null;
    if (userInputs.memberRelation) {
      member = policyInfo.insuredMembers?.find(m => 
        m.relationship.toLowerCase() === userInputs.memberRelation.toLowerCase()
      );
    }
    
    if (!member && policyInfo.insuredMembers && policyInfo.insuredMembers.length > 0) {
      member = policyInfo.insuredMembers[0]; // Default to first member
    }

    return {
      // User inputs
      dateOfAdmission: userInputs.dateOfAdmission,
      diagnosis: userInputs.diagnosis,
      estimatedCost: userInputs.estimatedCost,
      
      // Policy data
      policyNumber: policyInfo.policyNumber,
      memberFirstName: member?.name.split(' ')[0] || '',
      memberLastName: member?.name.split(' ').slice(1).join(' ') || '',
      memberDob: member?.dob ? this.formatDateForAPI(member.dob) : '',
      memberGender: userInputs.memberGender || 'Female',
      memberRelation: member?.relationship || 'Self',
      memberUHID: member?.memberId || '',
      mobileNumber: userInputs.mobileNumber || '9830323302',
      emailId: userInputs.emailId || 'customer@example.com',
      communicationAddress: userInputs.communicationAddress || '',
      communicationCity: userInputs.communicationCity || '',
      communicationPincode: userInputs.communicationPincode || '',
      
      // Hospital data
      hospitalName: hospitalData?.hospitalName || '',
      hospitalAddress: hospitalData?.hospitalAddress || '',
      hospitalAddressLine2: hospitalData?.city || '',
      hospitalCityTownVillage: hospitalData?.city || '',
      hospitalDistrict: hospitalData?.zone || '',
      hospitalState: hospitalData?.state || '',
      hospitalPincode: hospitalData?.pincode || '',
      hospitalCountry: 'INDIA'
    };
  }

  /**
   * Format date from "DD MMM YYYY" to "YYYY-MM-DD HH:mm:ss"
   * @param {string} dateStr - Date string like "15 Jun 1988"
   * @returns {string} - Formatted date
   */
  formatDateForAPI(dateStr) {
    try {
      const monthMap = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };
      
      const parts = dateStr.split(' ');
      const day = parts[0];
      const month = monthMap[parts[1]];
      const year = parts[2];
      
      return `${year}-${month}-${day} 00:00:00`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateStr;
    }
  }
}

module.exports = ClaimInitiationService;

