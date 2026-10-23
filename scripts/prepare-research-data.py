"""Build a source-qualified house catalog. Full source text stays in tmp, not web assets."""
from pathlib import Path
import json, re, csv, math, collections, hashlib
ROOT=Path(__file__).resolve().parents[1]
TMP=ROOT/'tmp/research'; OUT=ROOT/'outputs/wonderland-research'; DATA=ROOT/'data'
for p in [OUT,DATA]: p.mkdir(parents=True,exist_ok=True)
def load(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def clean(value): return re.sub(r'\s+',' ',str(value or '')).strip()
def unknown(value): return clean(value).casefold() in ['', 'unknown','uknown','untitled']
def address(value):
    text=clean(value).lower().split(',')[0].replace('.','')
    for a,b in [('ave','avenue'),('rd','road'),('dr','drive'),('ln','lane')]: text=re.sub(r'\b'+a+r'\b',b,text)
    return text
rows=load(TMP/'workbook-rows.json')
research=load(ROOT/'tmp/research-sources/evidence.json')
parcels=load(TMP/'parcels-response.json')['features']
groups=collections.defaultdict(list)
for row in rows:
    if row['row']==1 or not any(row.get(c) for c in 'ABCDEFGHI'): continue
    raw=clean(row.get('C'))
    # A resident-directory address is a separate, explicit correction, never an overwrite.
    if raw=='h' and 'Mann' in clean(row.get('B')): key='8929 wonderland park avenue'
    elif re.fullmatch(r'\d+(?:\s+1/2)? [a-zA-Z ]+',raw): key=address(raw)
    else: key='unresolved-row-'+str(row['row'])
    groups[key].append(row)
records=[]
for key,group in groups.items():
    valid=not key.startswith('unresolved')
    def collect(col): return list(dict.fromkeys(clean(row.get(col)) for row in group if not unknown(row.get(col))))
    years=collect('D'); numbers=sorted(set(int(y) for text in years for y in re.findall(r'\b(?:18|19|20)\d{2}\b',text)))
    names=collect('B'); architects=collect('A')
    issues=[]
    if len(group)>1: issues.append('Duplicate index rows retained: '+', '.join(str(r['row']) for r in group))
    if len(numbers)>1: issues.append('Index dates disagree or are uncertain: '+' / '.join(years))
    if not valid: issues.append('Address is incomplete or ambiguous; map location withheld')
    if group[0].get('C')=='h': issues.append('Original address is h; 8929 address supplied by 1966 resident directory, not original index')
    h=collect('H'); original='yes' if any('original' in x.lower() and 'maybe' not in x.lower() for x in h) else ('uncertain' if any('maybe' in x.lower() for x in h) else 'unknown')
    record=dict(objectid=len(records)+1,house_id='wpa-'+re.sub(r'[^a-z0-9]+','-',key).strip('-'),
        address=key.title() if valid else clean(group[0].get('C')),house_name=' / '.join(names) or (key.title() if valid else 'Unresolved index record'),
        architect=' / '.join(architects),year_min=min(numbers) if numbers else None,year_max=max(numbers) if numbers else None,
        year_text=' / '.join(years),contractor=' / '.join(collect('E')),original_owner=' / '.join(collect('F')),original_67=original,
        research_architect='',landscape_designer='',research_topics='',research_summary='',evidence_ids='',source_ids='SRC-WORKBOOK',
        source_rows='Sheet1 rows '+', '.join(str(r['row']) for r in group),latitude=None,longitude=None,parcel_apn='',
        location_status='not located',record_issues='; '.join(issues),research_review_date='2026-10-23')
    # Exact address matching only. Never match Wonderland Avenue to Wonderland Park Avenue.
    hits=[]
    if valid:
        for parcel in parcels:
            a=parcel['attributes']; fraction=clean(a.get('SitusFraction'))
            candidate=clean(a.get('SitusHouseNo'))+(' '+fraction if fraction else '')+' '+clean(a.get('SitusStreet'))
            if address(candidate)==key: hits.append(a)
    if len(hits)==1:
        a=hits[0];lat=a.get('CENTER_LAT');lon=a.get('CENTER_LON')
        if lat and lon and abs(lat-34.1148)<.03 and abs(lon+118.3895)<.04:
            record.update(latitude=lat,longitude=lon,parcel_apn=a['APN'],location_status='exact parcel situs-address match; parcel centroid, not building footprint')
    elif len(hits)>1: record['record_issues']+='; multiple parcels share the address; location withheld'
    records.append(record)
byaddress={address(r['address']):r for r in records if r['latitude'] is not None or not r['house_id'].startswith('wpa-unresolved')}
def idat(a):
    rec=byaddress.get(address(a)); return rec['house_id'] if rec else None
# Explicit resident directory links tie historical names to modern index addresses.
name_links={'Eckbo residence':'8942 Wonderland Park Avenue','Goldin residence':'8967 Wonderland Park Avenue',
'Stubbs residence':'8978 Wonderland Park Avenue','Fuss residence':'9091 Wonderland Park Avenue',
'Rykoff residence':'9015 Burroughs Road','Zeiger residence':'8941 Wonderland Park Avenue',
'Ellsworth residence':'9043 Burroughs Road','Hunter residence':'9060 Wonderland Park Avenue',
'Gollin residence':'9048 Wonderland Park Avenue','Bailey residence':'9038 Wonderland Park Avenue',
'Kimmelman residence':'8973 Wonderland Park Avenue','Jaffee residence':'9049 Wonderland Park Avenue',
'Goldstein residence':'8961 Wonderland Park Avenue'}
evidence=[]
for c in research['claims']:
    if c.get('exclude_from_wonderland_property_data'): continue
    link=(c.get('address') or name_links.get(c['subject'])) if c['scope']=='property' else None
    house_ids=[idat(link)] if link and idat(link) else []
    scope='property' if house_ids else ('unlocated_property' if c['scope']=='property' else c['scope'])
    pages=c.get('pdf_pages',[])
    source=next((s for s in research['sources'] if s['source_id']==c['source_id']),{})
    if source.get('extension') not in ['.pdf']: pages=[]
    evidence.append(dict(id=c['evidence_id'],house_ids=house_ids,claim=c['summary'],source_id=c['source_id'],pages=pages,
        topics=c.get('tags',[]),scope=scope,subject=c['subject'],research_architect=c.get('architect',''),
        landscape_designer=c.get('landscape_architect',''),date_note=c.get('date_conflict') or c.get('date_note') or '',
        qualification=c.get('caution',''),locator=(str(c.get('sheet',''))+' rows '+', '.join(map(str,c.get('spreadsheet_rows',[])))).strip() if c.get('spreadsheet_rows') else '',link_basis='Named property matched to index and historical resident directory' if house_ids else ''))
core_sources=[('CORE-06','06_WPHOA_1956-1958_GeneralMeetingMinutes.pdf'),('CORE-10','10_WPHOA_c1959-1966_MembershipMinutes_CivilRights.pdf'),('CORE-12','12_WPHOA_1965_AnniversaryPartyInvitations.pdf'),('CORE-17','17_WPHOA_1950-1966_FoundingDocs_Compilation.pdf')]
def core(n,source,pages,claim,addresses=(),topics=(),scope='property'):
    evidence.append(dict(id='CORE-E'+str(n).zfill(3),house_ids=[idat(a) for a in addresses if idat(a)],claim=claim,source_id=source,pages=pages,topics=list(topics),scope=scope,subject='Wonderland community archive',qualification='Historical archive; does not establish present ownership',link_basis='Address explicit in resident directory or correspondence' if addresses else ''))
core(1,'CORE-17',[7],'The January 1953 bulletin identifies Garrett Eckbo’s studio at 8942 and describes his tentative valley-wide tree and boundary planting plan as a flexible guide. Individual private designs were a separate commission.',['8942 Wonderland Park Avenue'],['Eckbo','master tree plan','1953'])
core(2,'CORE-17',[8,9],'The resident directory corrected July 27, 1966 identifies Meyer and Rose Goldin at 8967 Wonderland Park Avenue. This supplies the address link for the Goldin garden discussed by Libby Simon.',['8967 Wonderland Park Avenue'],['Goldin','1966 directory'])
core(3,'CORE-17',[8,9],'The 1966 directory identifies Phillip and Anne Kimmelman at 8973 and Irving and Beatrice Zeiger at 8941 Wonderland Park Avenue.',['8973 Wonderland Park Avenue','8941 Wonderland Park Avenue'],['Kimmelman','Zeiger','1966 directory'])
core(4,'CORE-17',[8,9],'The 1966 directory links George and Ethel Stubbs with 8978, Richard and Millie Hunter with 9060, Norman and Pat Gollin with 9048, Ed and Zona Mann with 8929, and Alex Greenberg with 9009 Burroughs Road.',['8978 Wonderland Park Avenue','9060 Wonderland Park Avenue','9048 Wonderland Park Avenue','8929 Wonderland Park Avenue','9009 Burroughs Road'],['1966 directory'])
core(5,'CORE-06',[41,33,17],'Kimmelman’s plans were submitted March 1, 1957, approved April 5, and construction was reported underway November 1, 1957.',['8973 Wonderland Park Avenue'],['Kimmelman','architectural review','1957'])
core(6,'CORE-10',[62],'November 7, 1958 minutes record Phil Kimmelman and Joe Pass investigating a community pool site. Kimmelman prepared a layout after meeting MacKay, Pass and Eckbo.',['8973 Wonderland Park Avenue','9008 Wonderland Park Avenue'],['Kimmelman','pool proposal','Eckbo','1958'])
core(7,'CORE-10',[32],'The September 9, 1960 membership meeting was hosted by Irving and Bea Zeiger. This is documented neighborhood involvement, not evidence of their named participation in C.O.R.E. activities.',['8941 Wonderland Park Avenue'],['Zeiger','community meetings','1960'])
core(8,'CORE-12',[1],'An invitation locates a January 14 “15th Annual Party” at the Zeiger home, 8941. The invitation has no year; the filename’s 1965 is unverified.',['8941 Wonderland Park Avenue'],['Zeiger','party','date uncertain'])
core(9,'CORE-10',[22],'March 17, 1961 minutes record a meeting at Alex Greenberg’s home with CORE speakers, a protest telegram and a $27 collection. The sources establish neighborhood cooperation with CORE, not a formal neighborhood CORE chapter.',['9009 Burroughs Road'],['CORE','C.O.R.E.','civil rights','1961'])
core(10,'CORE-10',[105],'A March 23, 1961 letter from Eloise and Alex Greenberg at 9009 Burroughs Road offers solidarity to Brownsville Tent City and describes support for voting rights and integrated community life.',['9009 Burroughs Road'],['CORE','C.O.R.E.','civil rights','integration','Tent City'])
core(11,'CORE-10',[21],'April 24, 1961 board minutes direct a $25 CORE check through Eloise Greenberg. This amount should not be added to other figures as a verified total.',['9009 Burroughs Road'],['CORE','C.O.R.E.','1961'])
core(12,'CORE-10',[15,16],'June 2, 1961 minutes record $137 collected plus pledges for Tent City through CORE. Eloise Greenberg organized a clothing collection and Pat Gollin offered to arrange CORE mailing-list enrollment.',['9009 Burroughs Road','9048 Wonderland Park Avenue'],['CORE','C.O.R.E.','Tent City','Gollin','civil rights'])
core(13,'CORE-10',[106,107],'Tent City correspondence documents voting retaliation, eviction, lost credit or employment and requests for assistance. Donation figures in separate records are not a verified cumulative total.',[],['CORE','C.O.R.E.','voting rights','Tent City'],'neighborhood')
# Append only property-linked findings to house fields. General theory stays searchable separately.
for r in records:
    ev=[e for e in evidence if r['house_id'] in e['house_ids']]
    r['evidence_ids']='; '.join(e['id'] for e in ev)
    r['source_ids']='; '.join(dict.fromkeys(['SRC-WORKBOOK']+[e['source_id'] for e in ev]+(['SRC-PARCELS'] if r['latitude'] is not None else [])))
    r['research_topics']='; '.join(dict.fromkeys(t for e in ev for t in e['topics']))
    r['research_summary']=' '.join(e['claim'] for e in ev if e['id'].startswith('EVID-'))[:5000]
    r['research_architect']=' / '.join(dict.fromkeys(e['research_architect'] for e in ev if e.get('research_architect')))
    r['landscape_designer']=' / '.join(dict.fromkeys(e['landscape_designer'] for e in ev if e.get('landscape_designer')))
    notes=[e['date_note'] for e in ev if e.get('date_note')]
    if r['house_id']=='wpa-8942-wonderland-park-avenue': notes.append('Index date 1951; sources describe construction in 1951, occupancy in 1952 and a caption dated 1953. Distinguish events, not a single verified completion year.')
    if r['house_id']=='wpa-8941-wonderland-park-avenue': notes.append('Index date 1959; Simon describes design/landscape in 1958; master index project dated 1957. Date meanings differ.')
    if r['house_id']=='wpa-8961-wonderland-park-avenue': notes.append('Index calls house Karney; saved Simon correspondence calls this address Goldstein. Historical name attribution differs.')
    if r['research_architect'] and r['architect'] and r['research_architect'].lower() not in r['architect'].lower(): notes.append('Index architect and research attribution differ; original index text retained.')
    r['record_issues']='; '.join(filter(None,[r['record_issues']]+list(dict.fromkeys(notes))))
sources=[dict(id=s['source_id'],title=s['name'],filename=s['name'],status=s['status'],sha256=s.get('sha256','')) for s in research['sources']]
sources += [dict(id=key,title=name,filename=name,status='prior-chat page-labelled OCR reviewed') for key,name in core_sources]
sources += [dict(id='SRC-WORKBOOK',title='Index Wonderland Park Houses.xlsx',filename='Index Wonderland Park Houses.xlsx',status='original index rows retained'),dict(id='SRC-PARCELS',title='Los Angeles County Parcels - situs addresses and parcel centroids',url='https://cache.gis.lacounty.gov/cache/rest/services/LACounty_Cache/LACounty_Parcel/FeatureServer/0',status='retrieved 2026-10-23; exact address matches only')]
corpus=dict(version=1,updated='2026-10-23',records=records,evidence=evidence,sources=sources,limitations=research['limitations']+['Locations are parcel centroids, not measured building footprints. Unmatched/ambiguous addresses are retained in the table but omitted from the map.','Index records are student research, not independently verified permits. Source-specific conflicting attributions remain visible.'])
(DATA/'research-evidence.json').write_text(json.dumps(corpus,ensure_ascii=False,indent=2),encoding='utf-8')
features=[dict(type='Feature',id=r['objectid'],geometry=dict(type='Point',coordinates=[r['longitude'],r['latitude']]),properties=r) for r in records if r['latitude'] is not None]
geo=dict(type='FeatureCollection',name='Wonderland Park Houses Research',features=features)
(DATA/'wonderland-houses.geojson').write_text(json.dumps(geo,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'Wonderland_Park_Houses.geojson').write_text(json.dumps(geo,ensure_ascii=False,indent=2),encoding='utf-8')
with (OUT/'Wonderland_Park_Houses.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(records)
# Preserve unresolved source rows and source inventory for workbook authoring.
(TMP/'workbook-data.json').write_text(json.dumps(dict(records=records,evidence=evidence,sources=sources,source_inventory=research['sources'],rows=rows),ensure_ascii=False),encoding='utf-8')
print(json.dumps(dict(index_rows=sum(len(g) for g in groups.values()),house_records=len(records),located=len(features),evidence=len(evidence),unlocated=[r['address'] for r in records if r['latitude'] is None]),ensure_ascii=True))
