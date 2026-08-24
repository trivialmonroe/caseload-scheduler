/**
 * Shared constants and configuration used across every file in this project.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };

const SHEET_NAMES = {
  README: 'Read Me',
  STUDENTS: 'Students',
  GRADES: 'Grades',
  CONSTRAINTS: 'Constraints',
  AVAILABILITY: 'MyAvailability',
  SETTINGS: 'Settings',
  LOG: 'Schedule_Log',
  OPENSLOTS: 'Open_Slots',
  VISUAL: 'Printable_Schedule',
  REVIEW: 'Schedule_Review'
};

const INPUT_TAB_COLOR = '#c9daf8';   // light blue - tabs you edit

const OUTPUT_TAB_COLOR = '#d9ead3';  // light green - tabs the script generates

const README_TAB_COLOR = '#fce8b2'; // light amber - reference tab

const ALL_WEEKS_KEY = 'ALL'; // marks a weekly-recurring session that repeats every quarter week

const ANY_WEEK_KEY = 'ANY';  // marks a quarterly session not yet pinned to a specific week - the

const COLUMN_LAYOUT = {
  [SHEET_NAMES.STUDENTS]: [
    { width: 110, align: 'left' },   // Student ID
    { width: 90, align: 'left' },    // First Name
    { width: 90, align: 'left' },    // Last Name
    { width: 55, align: 'center' },  // Grade
    { width: 110, align: 'center' }, // Service Type
    { width: 120, align: 'left' },   // Group ID
    { width: 105, align: 'center' }, // Frequency Type
    { width: 90, align: 'right' },   // Minutes/Week Required
    { width: 90, align: 'right' },   // Preferred Session Length
    { width: 90, align: 'right' },   // Sessions Per Quarter
    { width: 90, align: 'right' },   // Session Length (Quarterly)
    { width: 130, align: 'center' }, // Sessions/Week (auto)
    { width: 240, align: 'left' },   // Notes
    { width: 85, align: 'center' },  // Status
    { width: 130, align: 'left' },   // Teacher
    { width: 90, align: 'center' },  // Fixed Day
    { width: 110, align: 'center' }, // Fixed Start Time
    { width: 90, align: 'center' }   // No Group
  ],
  [SHEET_NAMES.GRADES]: [
    { width: 60, align: 'center' },  // Grade
    { width: 170, align: 'left' },   // Day
    { width: 100, align: 'center' }, // Start Time
    { width: 100, align: 'center' }, // End Time
    { width: 220, align: 'left' }    // Reason
  ],
  [SHEET_NAMES.CONSTRAINTS]: [
    { width: 110, align: 'left' },   // Student ID
    { width: 170, align: 'left' },   // Day
    { width: 100, align: 'center' }, // Start Time
    { width: 100, align: 'center' }, // End Time
    { width: 220, align: 'left' }    // Reason
  ],
  [SHEET_NAMES.AVAILABILITY]: [
    { width: 170, align: 'left' },   // Day
    { width: 100, align: 'center' }, // Start Time
    { width: 100, align: 'center' }, // End Time
    { width: 90, align: 'center' },  // Week Pattern
    { width: 220, align: 'left' }    // Notes
  ],
  [SHEET_NAMES.SETTINGS]: [
    { width: 240, align: 'left' },   // Setting
    { width: 180, align: 'left' }    // Value (mixed text/number, left reads more consistently)
  ],
  [SHEET_NAMES.LOG]: [
    { width: 110, align: 'left' },   // Student ID
    { width: 140, align: 'left' },   // Name
    { width: 60, align: 'center' },  // Grade
    { width: 110, align: 'left' },   // Group ID
    { width: 90, align: 'center' },  // Week
    { width: 70, align: 'center' },  // Day
    { width: 95, align: 'center' },  // Start Time
    { width: 95, align: 'center' },  // End Time
    { width: 95, align: 'right' },   // Duration (min)
    { width: 150, align: 'left' },   // Teacher
    { width: 100, align: 'center' }  // Locked
  ]
};

const SCHEDULE_COLOR_PALETTE = [
  { bg: '#7C5CFC', text: '#FFFFFF' }, // vivid purple
  { bg: '#00BFA5', text: '#FFFFFF' }, // vivid teal
  { bg: '#FF6B35', text: '#FFFFFF' }, // vivid orange
  { bg: '#EC4899', text: '#FFFFFF' }, // vivid pink
  { bg: '#2E86F0', text: '#FFFFFF' }, // vivid blue
  { bg: '#F5A623', text: '#1A1200' }, // vivid amber (dark text - light enough to need it)
  { bg: '#26C281', text: '#FFFFFF' }, // vivid green
  { bg: '#EF4444', text: '#FFFFFF' }  // vivid red
];
