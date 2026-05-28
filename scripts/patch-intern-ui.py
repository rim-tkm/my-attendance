#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "app" / "page.tsx"
text = p.read_text()
changed = False

# 1. Admin KPI modal confirmed fields
needle1 = '            ))}\n          </div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
if needle1 not in text:
    needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
if needle1 not in text:
    needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
# definitive from probe
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'

# From probe output exactly:
needle1 = "            ))}\n          </motion.div>\n          <motion.div className=\"flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4\">"
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'

# STOP - use probe result literally
needle1 = '            ))}\n          </motion.div>\n          <motion.div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">'
