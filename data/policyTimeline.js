const policyTimelineData = {
  "customerId": "9830323302",
  "policyTimeline": {
    "policyNumber": "7000170537-02",
    "policyholder": "Vineet Singh",
    "policyPeriod": {
      "from": "12 Sept 2025",
      "to": "11 Sept 2026"
    },
    "plan": "TATA AIG MediCare Premier",
    "sumInsured": "₹50,00,000",
    "cumulativeBonus": "₹37,50,000",
    "grossPremium": "₹54,940",
    "insuredMembers": [
      {
        "name": "Vineet Singh",
        "dob": "15 Jun 1988",
        "age": 37,
        "relationship": "Self",
        "memberId": "IDV00079566201035"
      },
      {
        "name": "Punita Singh",
        "dob": "24 Oct 1989",
        "age": 35,
        "relationship": "Spouse",
        "memberId": "IDV00079566202033"
      },
      {
        "name": "Aradhya Singh",
        "dob": "18 May 2016",
        "age": 9,
        "relationship": "Daughter",
        "memberId": "IDV00079566203007"
      },
      {
        "name": "Akshat Singh",
        "dob": "29 Mar 2012",
        "age": 13,
        "relationship": "Son",
        "memberId": "IDV00079566204011"
      }
    ],
    "events": [
      {
        "date": "11 Sept 2026",
        "status": "Upcoming",
        "title": "Policy Expiry",
        "details": "Coverage under current policy year ends for all insured members. Renewal required for continued benefits.",
        "benefitValue": null,
        "insuredRelationship": "Family"
      },
      {
        "date": "31 October 2025",
        "status": "Upcoming",
        "title": "Health Checkup Booked",
        "details": "Sample collection pending for Akshat. Appointment booked at SRL Diagnostics. Sample collection scheduled on 25 Sept 2025 at 09:00 AM.",
        "benefitValue": "₹8,000 (not yet utilized)",
        "insuredRelationship": "Self"
      },
      {
        "date": "22 Sept 2025",
        "status": "Completed",
        "title": "Teleconsultation",
        "details": "Teleconsultation for Punita Singh with Dr. R. Mehra (General Physician) for mild stomach infection. Prescription shared via email.",
        "benefitValue": "₹1,500",
        "insuredRelationship": "Spouse"
      },
      {
        "date": "20 Sept 2025",
        "status": "Completed",
        "title": "Health Checkup Completed",
        "details": "Comprehensive health checkup done at Apollo Diagnostics for Vineet Singh. All results normal.",
        "benefitValue": "₹8,000",
        "insuredRelationship": "Self"
      },
      {
        "date": "15 Sept 2025",
        "status": "Completed",
        "title": "Claim Processed: 4000034565",
        "details": "Insurance claim for hospitalization processed successfully as a cashless claim for Akshat Singh. Amount approved: ₹15,000.",
        "insuredRelationship": "Son"
      },
      {
        "date": "09 Sept 2025",
        "status": "Completed",
        "title": "Hospitalization",
        "details": "Cashless admission at City Hospital for Akshat Singh for minor surgery. Discharged on 11th September.",
        "insuredRelationship": "Son"
      },
      {
        "date": "12 Sept 2025",
        "status": "Completed",
        "title": "Policy Renewed",
        "details": "Policy coverage started for all insured members under TATA AIG MediCare Premier.",
        "benefitValue": null,
        "insuredRelationship": "Family"
      },
      {
        "date": "29 Aug 2025",
        "status": "Completed",
        "title": "Premium Paid",
        "details": "Premium of ₹54,940 paid online for renewal. Receipt No. 104001115219145.",
        "benefitValue": null,
        "insuredRelationship": "Policyholder"
      },
      {
        "date": "05 Oct 2025",
        "status": "Completed",
        "title": "Teleconsultation",
        "details": "Teleconsultation for Aradhya Singh with Pediatrician Dr. S. Kapoor for seasonal flu symptoms. Prescription shared via email.",
        "benefitValue": "₹1,200",
        "insuredRelationship": "Daughter"
      },
      {
        "date": "18 Oct 2025",
        "status": "Completed",
        "title": "Wellness Activity: Yoga Workshop",
        "details": "Punita Singh attended an online Yoga & Wellness workshop organized by TATA AIG as part of wellness benefits.",
        "benefitValue": "₹800",
        "insuredRelationship": "Spouse"
      },
      {
        "date": "25 Nov 2025",
        "status": "Completed",
        "title": "Claim Processed: 4000035123",
        "details": "Reimbursement claim processed for Vineet Singh for outpatient consultation. Amount approved: ₹2,000.",
        "insuredRelationship": "Self"
      }
    ],
    "benefitsSummary": {
      "totalBenefitsWorth": "₹24,500 utilized",
      "pendingBenefits": "₹8,000 booked (sample pending)"
    }
  }
};

module.exports = policyTimelineData;


