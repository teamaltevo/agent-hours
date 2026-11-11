from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
import json
import re

from ratio_chart import chart_data,svg_chart,html_page,scale


class RatioChartTests(unittest.TestCase):
    def report(self):
        return {'since':'2026-11-01','until':'2026-11-03','clients':{'opencode':{}},
                'primary_ratio_client':'opencode','classification_counts':{'work':1},
                'classifier_counts':{'failed_calls':0},'PRIVATE_EXTRA':'NEVER_EMBED',
                'observed_day_aggregates':{'opencode':{'ratio':.5}},
                'days':[{'date':'2026-11-01','developer_hours':8,'history_observed_by_client':{'opencode':True},
                         'captured_work_hours_by_client':{'opencode':4},'ratios_by_client':{'opencode':.5}},
                        {'date':'2026-11-02','developer_hours':4,'history_observed_by_client':{'opencode':True},
                         'captured_work_hours_by_client':{'opencode':0},'ratios_by_client':{'opencode':0}},
                        {'date':'2026-11-03','developer_hours':0,'history_observed_by_client':{'opencode':True},
                         'captured_work_hours_by_client':{'opencode':None},'ratios_by_client':{'opencode':None}}]}

    def test_nulls_omitted_but_observed_zeros_retained(self):
        values=chart_data(self.report())['opencode']
        self.assertEqual(len(values['points']),2)
        self.assertEqual(values['points'][1]['ratio'],0)
        self.assertEqual(values['zero_work'],1)

    def test_static_svg_is_well_formed_and_scale_contains_every_point(self):
        data=chart_data(self.report())['opencode']
        maximum,_=scale(data['points'])
        self.assertGreaterEqual(maximum,max(p['ratio'] for p in data['points']))
        root=ET.fromstring(svg_chart('opencode',data,standalone=True))
        self.assertTrue(root.tag.endswith('svg'))

    def test_html_embeds_only_selected_aggregate_data(self):
        report=self.report()
        page=html_page(report,Path('reports/public.json'),chart_data(report))
        self.assertNotIn('NEVER_EMBED',page)
        self.assertIn('data-ve-kit',page)
        self.assertIn('<figcaption>',page)
        self.assertNotIn('fetch(',page)

    def test_dashboard_focus_payload_and_extra_stats_are_valid(self):
        report=self.report(); page=html_page(report,Path('reports/public.json'),chart_data(report))
        match=re.search(r'<script id="ratio-extra-data" type="application/json">(.*?)</script>',page,re.S)
        data=json.loads(match.group(1))
        ET.fromstring(data['focusSvg'])
        self.assertEqual(len(data['points']),2)
        self.assertIn('What sits behind the headline ratio',page)
        self.assertIn('Excluded does not mean proven personal',page)
        self.assertIn('No runtime phases were profiled',page)
        self.assertNotIn('NEVER_EMBED',page)

    def test_focused_chart_marks_clipped_values_without_changing_data(self):
        values=chart_data(self.report())['opencode']
        text=svg_chart('opencode',values,y_limit=.25)
        self.assertIn('overflow-marker',text)
        self.assertIn('0.5000 activity h/work h',text)
        self.assertEqual(values['points'][0]['ratio'],.5)
