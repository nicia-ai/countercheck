import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('followup',Path(__file__).resolve().parents[1]/'scripts/analyze-calibration-followup.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def row(id,positive,c,verdict='uncertain'):
 return {'pair':{'id':id,'gold':'contradiction' if positive else 'non_contradiction'},'prediction':{'status':'ok','verdict':verdict,'raw_scores':{'contradiction':c,'consistent':1-c,'different_scope':0,'insufficient_context':0}}}


class FollowupTests(unittest.TestCase):
 def test_budget_is_absolute_count_and_positive_gate_fixed(self):
  rows=[row('p',True,.1),row('n1',False,.1),row('n2',False,.2),row('hit',True,.9,'contradiction')]
  a=m.fit_negative(rows,.8,0);b=m.fit_negative(rows,.8,1)
  self.assertEqual(b,dict(positive=.8,negative_cut=.2,negative_support=0))
  self.assertEqual(m.measures(m.counts([m.remap(r,a) for r in rows]))['tn'],0)
  self.assertEqual(m.measures(m.counts([m.remap(r,b) for r in rows]))['false_clears'],1)
  for r in rows:self.assertEqual(m.remap(r,a)['prediction']['verdict']=='contradiction',m.remap(r,b)['prediction']['verdict']=='contradiction')

 def test_zero_budget_matches_original_independent_fitter(self):
  rows=[row('a',True,.8),row('b',False,.1),row('c',False,.2)]
  old=m.BASE['fitted_policy'](rows)
  self.assertEqual(m.fit_negative(rows,old['positive'],0),old)

 def test_missing_scores_never_count_as_negative_evidence(self):
  rows=[row('a',True,.8),row('b',False,.1)]
  missing={'pair':{'gold':'contradiction'},'prediction':{'status':'error','error_code':'deadline_exceeded'}}
  self.assertEqual(m.fit_negative(rows,.8,1),m.fit_negative(rows+[missing],.8,1))

 def test_timeout_bounds_do_not_impute_answers(self):
  rows=[row('a',True,.9,'contradiction'),row('b',True,.1,'uncertain'),row('n',False,.1)]
  rows.append({'pair':{'gold':'contradiction'},'prediction':{'status':'error','error_code':'deadline_exceeded'}})
  s=m.timeout_sensitivity(rows)
  self.assertEqual(s['deadline_inclusive_recall'],1/3)
  self.assertEqual(s['successful_subset_recall'],1/2)
  self.assertEqual(s['missing_answer_recall_bounds'],[1/3,2/3])
  self.assertEqual(s['missing_native_positives'],1)

 def test_missing_negatives_do_not_raise_positive_upper_bound(self):
  rows=[row('a',True,.9,'contradiction'),{'pair':{'gold':'non_contradiction'},'prediction':{'status':'error','error_code':'deadline_exceeded'}}]
  self.assertEqual(m.timeout_sensitivity(rows)['missing_answer_recall_bounds'],[1,1])

 def test_no_successful_positives_has_undefined_conditional_recall(self):
  rows=[{'pair':{'gold':'contradiction'},'prediction':{'status':'error','error_code':'deadline_exceeded'}}]
  s=m.timeout_sensitivity(rows)
  self.assertIsNone(s['successful_subset_recall']);self.assertEqual(s['missing_answer_recall_bounds'],[0,1])

 def test_fractional_budget_rejected(self):
  with self.assertRaises(ValueError):m.fit_negative([],.8,.5)


if __name__=='__main__':unittest.main()
