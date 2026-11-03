#!/usr/bin/env python3
"""Independent replay. Standard library only. Does not import application code."""
import copy, hashlib, json, sys, re

def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def sha(x):
    return hashlib.sha256((x if isinstance(x,str) else canon(x)).encode('utf-8')).hexdigest()

def require(ok, reason):
    if not ok: raise ValueError(reason)

def verify(bundle):
    m=bundle['manifest']; files=bundle['artifacts']
    require(type(m['schema'])==int and m['schema'] in [1,2] and m['algorithm']=='SHA-256' and m['encoding']=='UTF-8','UNSUPPORTED_SCHEMA')
    expected={'initial.json','events.json','final.json','limitations.json'}
    if m['schema']==2: expected.add('interpretations.json')
    require(set(files)==expected and set(m['files'])==expected,'ARTIFACT_SET')
    for name, content in files.items():
        require('/' not in name and '\\' not in name and '..' not in name,'UNSAFE_PATH')
        require(sha(content)==m['files'][name],f'HASH_MISMATCH:{name}')
        require(canon(json.loads(content))==content,'NON_CANONICAL')
    s=json.loads(files['initial.json']); final=json.loads(files['final.json']); events=json.loads(files['events.json'])
    require(s['schema']==1 and s['version']==0 and s['events']==[],'INVALID_INITIAL')
    require(s['id']==final['id'] and s['tenant']==final['tenant'],'SCOPE_MISMATCH')
    plans={}; work={}; seen=set(); last_action=None; last_kind=None; previous='0'*64
    def room(rid):
        return next(r for r in s['rooms'] if r['id']==rid)
    def batch(bid):
        return next(b for b in s['batches'] if b['id']==bid)
    def fresh(r):
        require(0<=s['clock']-r['observation']['at']<=r['observation']['ttl'],'STALE_OBSERVATION')
    def used(rid):
        return room(rid)['background']+sum(b['locations'].get(rid,0)*b['slotsPerUnit'] for b in s['batches'])
    def held(rid):
        return sum(w['transfer']['quantity']*batch(w['transfer']['batch'])['slotsPerUnit'] for w in work.values() if w['transfer']['destination']==rid and w['state'] in ['RESERVED','DISPATCHED','ARRIVAL_REPORTED'])
    def quantities():
        for b in s['batches']:
            require(all(type(q)==int and q>=0 for q in b['locations'].values()),'NEGATIVE_QUANTITY')
            require(sum(b['locations'].values())==b['quantity'],'CONSERVATION')
        for r in s['rooms']:
            require(used(r['id'])+held(r['id'])<=r['capacity'],'CAPACITY_EXCEEDED')
    quantities()
    for idx,e in enumerate(events):
        require(e['seq']==idx+1 and e['priorVersion']==s['version'],'EVENT_ORDER')
        raw={k:v for k,v in e.items() if k!='hash'}
        require(e['previousHash']==previous and sha(raw)==e['hash'],'EVENT_CHAIN')
        k=e['kind']; d=e['data']; a=e['actionId']
        # One reserve action may create several adjacent reservation events.
        require(a not in seen or (a==last_action and k=='RESERVED' and last_kind=='RESERVED'),'DUPLICATE_ACTION')
        seen.add(a); last_action=a; last_kind=k;previous=e['hash']
        require(s['status']!='RECONCILED','CLOSED_EVENT')
        if k=='CLOCK_ADVANCED':
            require(type(d['minutes'])==int and 0<d['minutes']<=1440,'INVALID_CLOCK')
            s['clock']+=d['minutes']
        require(e['at']==s['clock'],'OCCURRENCE_TIME')
        if k=='FACTS_CONFIRMED':
            require(d['quantities']=={b['id']:b['quantity'] for b in s['batches']},'INVENTORY_CONFLICT')
            s['uncertain']=False;s['status']='FACTS_REVIEWED'
        elif k=='OBSERVED':
            r=room(d['room']);o=d['observation'];require(o['at']==s['clock'] and o['source']=='SYNTHETIC' and o['ttl']==30 and type(o['temp'])==int and type(o['healthy'])==bool,'INVALID_OBSERVATION');r['observation']=copy.deepcopy(o)
            if not o['healthy'] and any(w['transfer']['destination']==r['id'] and w['state'] in ['DISPATCHED','ARRIVAL_REPORTED'] for w in work.values()):s['status']='NEEDS_HUMAN'
        elif k=='PLAN_PROPOSED':
            require(not s['uncertain'] and d['id'] not in plans and d['digest']==sha(d['transfers']) and not d['approved'],'INVALID_PLAN')
            require(d['observationRefs']==[r['observation']['id'] for r in s['rooms']],'UNBOUND_OBSERVATIONS')
            for t in d['transfers']:
                require(type(t['quantity'])==int and t['quantity']>0,'INVALID_QUANTITY')
                batch(t['batch']);room(t['destination'])
                require(t['responder'] in s['responders'] and any(v['id']==t['vehicle'] for v in s['vehicles']),'RESOURCE_UNAVAILABLE')
            if d.get('replacesPlanId'):
                old=plans[d['replacesPlanId']];require(not any(w['planId']==old['id'] and w['state'] in ['RESERVED','DISPATCHED','ARRIVAL_REPORTED'] for w in work.values()),'ACTIVE_PLAN_WORK');old['approved']=False;s['status']='FACTS_REVIEWED'
            plans[d['id']]=copy.deepcopy(d)
        elif k=='PLAN_APPROVED':
            p=plans[d['planId']];require(p['digest']==d['digest'] and not s['uncertain'],'APPROVAL_MISMATCH');p['approved']=True;s['status']='PLAN_APPROVED'
        elif k=='RESERVED':
            require(d['id'] not in work,'DUPLICATE_WORK');p=plans[d['planId']];t=d['transfer'];b=batch(t['batch']);r=room(t['destination']);fresh(r);fresh(room(b['origin']))
            require(p['approved'] and t in p['transfers'] and sha(p['transfers'])==p['digest'],'UNAPPROVED_TRANSFER')
            require(r['observation']['healthy'] and not room(b['origin'])['observation']['healthy'] and r['id']!=b['origin'],'INVALID_DESTINATION')
            require(b['class'] in r['classes'],'INCOMPATIBLE_STOCK')
            stockheld=sum(w['transfer']['quantity'] for w in work.values() if w['transfer']['batch']==b['id'] and w['state']=='RESERVED')
            require(b['locations'].get(b['origin'],0)-stockheld>=t['quantity'],'INSUFFICIENT_STOCK')
            require(d['expires']==s['clock']+20 and d['fence']==1 and d['state']=='RESERVED','INVALID_RESERVATION')
            require(t['quantity']*b['slotsPerUnit']<=next(v['slots'] for v in s['vehicles'] if v['id']==t['vehicle']),'VEHICLE_CAPACITY')
            work[d['id']]=copy.deepcopy(d);s['status']='RESERVED'
        elif k in ['DISPATCHED','ARRIVAL_REPORTED','ARRIVAL_CONFIRMED','CANCELLED']:
            w=work[d['workId']];t=w['transfer'];b=batch(t['batch']);r=room(t['destination']);q=t['quantity']
            require(plans[w['planId']]['approved'],'UNAPPROVED_WORK')
            if k=='DISPATCHED':
                require(w['state']=='RESERVED' and s['clock']<w['expires'],'INVALID_DISPATCH');fresh(r);fresh(room(b['origin']))
                require(r['observation']['healthy'],'DESTINATION_WARM')
                require(d['fence']==w['fence'] and d['planDigest']==plans[w['planId']]['digest'],'STALE_WORKER')
                require(not any(x['state'] in ['DISPATCHED','ARRIVAL_REPORTED'] and (x['transfer']['vehicle']==t['vehicle'] or x['transfer']['responder']==t['responder']) for x in work.values()),'RESOURCE_BUSY')
                duration=next(v['duration'] for v in s['vehicles'] if v['id']==t['vehicle'])
                require(s['clock']+duration<=b['deadline'],'HANDLING_DEADLINE')
                b['locations'][b['origin']]-=q;b['locations']['transit:'+w['id']]=q;w['state']='DISPATCHED';w['departedAt']=s['clock'];s['status']='IN_PROGRESS'
            elif k=='ARRIVAL_REPORTED':
                require(w['state']=='DISPATCHED' and d['actor']==t['responder'],'INVALID_REPORT');w['state']='ARRIVAL_REPORTED';w['reportedAt']=s['clock']
            elif k=='ARRIVAL_CONFIRMED':
                require(w['state']=='ARRIVAL_REPORTED' and d['authority']=='simulator','INVALID_ARRIVAL_AUTHORITY')
                require(d['quantity']==q and b['locations'].get('transit:'+w['id'])==q,'ARRIVAL_QUANTITY')
                duration=next(v['duration'] for v in s['vehicles'] if v['id']==t['vehicle'])
                require(w['departedAt']+duration<=s['clock']<=b['deadline'],'NOT_ARRIVED');fresh(r);require(r['observation']['healthy'],'DESTINATION_WARM_IN_TRANSIT')
                del b['locations']['transit:'+w['id']];b['locations'][r['id']]=b['locations'].get(r['id'],0)+q;w['state']='ARRIVAL_CONFIRMED';w['arrivalReceipt']=d['receipt']
            else:
                require(w['state']=='RESERVED','CANNOT_RELEASE_IN_TRANSIT');w['state']='CANCELLED';w['fence']+=1
        elif k=='RECONCILED':
            require(not s['uncertain'] and all(w['state'] in ['CANCELLED','ARRIVAL_CONFIRMED'] for w in work.values()),'UNRESOLVED_WORK')
            require(all(q==0 or (loc in [r['id'] for r in s['rooms']] and room(loc)['observation']['healthy']) for b in s['batches'] for loc,q in b['locations'].items()),'AT_RISK_STOCK')
            require(d['quantities']=={b['id']:b['quantity'] for b in s['batches']},'QUANTITY_MISMATCH');s['status']='RECONCILED'
        elif k!='CLOCK_ADVANCED':raise ValueError('UNKNOWN_EVENT')
        s['version']+=1;s['plans']=list(plans.values());s['work']=list(work.values());s['events'].append(e);quantities()
    require(canon(s)==canon(final),'FINAL_STATE_MISMATCH')
    records=json.loads(files['interpretations.json']) if m['schema']==2 else []
    require(type(records)==list and len(records)<=10,'INVALID_INTERPRETATIONS')
    seen_intakes=set()
    number_words=dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(),range(21)))
    for record in records:
        require(record['actionId'] not in seen_intakes,'DUPLICATE_INTAKE');seen_intakes.add(record['actionId'])
        require(record['incidentId']==s['id'] and type(record['version'])==int and 0<=record['version']<=s['version'],'INTAKE_SCOPE')
        source=record['source']
        require(source=={'id':'incident-notes','text':s['notes'],'hash':sha(s['notes'])},'INTAKE_SOURCE_MISMATCH')
        require(record['mode'] in ['FIXTURE_REPLAY','META'],'INTAKE_MODE')
        require(record['status'] in ['PENDING','NEEDS_REVIEW','UNAVAILABLE','FAILED','UNKNOWN_OUTCOME'],'INTAKE_STATUS')
        if record['mode']=='FIXTURE_REPLAY' and record['provider']:
            require(record['provider']['model'] is None and record['provider']['usage'] is None,'FIXTURE_CANNOT_CLAIM_MODEL')
        review=record.get('review');candidate=review.get('candidate') if review else None
        if review:
            require(review['status']=='NEEDS_REVIEW','MODEL_CANNOT_APPROVE')
        if candidate:
            require(set(candidate)=={'facts','questions'} and len(candidate['facts'])<=8,'INTAKE_SCHEMA')
            for fact in candidate['facts']:
                require(set(fact)=={'batchId','quantity','unit','sourceId','quote','confidence'},'INTAKE_FACT_SCHEMA')
                require(fact['batchId'] in [b['id'] for b in s['batches']] and fact['sourceId']=='incident-notes' and fact['unit']=='crate','INTAKE_FACT_BINDING')
                require(type(fact['quantity'])==int and 0<=fact['quantity']<=100000 and fact['confidence'] in ['supported','uncertain'],'INTAKE_FACT_VALUE')
                quote=fact['quote'];require(type(quote)==str and len(quote)>=3 and s['notes'].count(quote)==1,'INTAKE_QUOTE_MISMATCH')
                bound_batch=next(batch for batch in s['batches'] if batch['id']==fact['batchId'])
                aliases=['leafy greens','greens','leaf-01'] if bound_batch['class']=='leaf' else ['tomato','tomatoes','fruit-02'] if bound_batch['class']=='fruit' else [bound_batch['name'].lower(),bound_batch['id']]
                require(any(re.search(r'\b'+re.escape(alias)+r'\b',quote.lower()) for alias in aliases),'INTAKE_BATCH_NOT_GROUNDED')
                numbers=re.findall(r'\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b',quote.lower())
                require(numbers and all((number_words[n] if n in number_words else int(n))==fact['quantity'] for n in numbers),'INTAKE_QUANTITY_NOT_GROUNDED')
                require(not re.search(r'\b(not|never|ignore|example|previously|instead|kg|kilograms?|pounds?|litres?|boxes?)\b|\d[.,]\d|-\d',quote.lower()),'INTAKE_UNSUPPORTED_QUOTE')
                if re.search(r'\b(looks? like|maybe|about|roughly|uncertain|estimate|confirm|not sure|possibly)\b|\?',quote.lower()):require(fact['confidence']=='uncertain','INTAKE_INVENTED_CERTAINTY')
            if review['canApply']:require(all(any(fact['batchId']==batch['id'] for fact in candidate['facts']) for batch in s['batches']),'INTAKE_INCOMPLETE_FACTS')
        human=record.get('humanReview')
        if human:
            require(candidate and review['canApply'] and record['status']=='NEEDS_REVIEW','INTAKE_NOT_REVIEWABLE')
            event=next((event for event in events if event['actionId']==human['actionId'] and event['kind']=='FACTS_CONFIRMED'),None)
            require(event and event['priorVersion']==human['version']==record['version'] and event['data']['quantities']==human['quantities'],'INTAKE_HUMAN_REVIEW_BINDING')
            require(all(any(fact['batchId']==bid and fact['quantity']==quantity for fact in candidate['facts']) for bid,quantity in human['quantities'].items()),'INTAKE_REVIEW_QUANTITY')
    return {'status':'VERIFIED_REPLAY','events':len(events),'quantity':sum(b['quantity'] for b in s['batches']),'incidentStatus':s['status'],'interpretations':len(records),'limitations':'Internal synthetic consistency. No physical validation, independently authenticated model execution or independent signature.'}

if __name__=='__main__':
    try:
        with open(sys.argv[1],encoding='utf-8') as f: result=verify(json.load(f))
        print(json.dumps(result));sys.exit(0)
    except Exception as ex:
        print(json.dumps({'status':'FAILED','reason':str(ex)}));sys.exit(1)
