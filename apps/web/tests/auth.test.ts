import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Adapter,AdapterSession,AdapterUser} from 'next-auth/adapters';
import {inspectAuthSettings,normalizeEmail,SESSION_SECONDS} from '../src/server/configuration/auth';
import {AccessError,authorizeIdentity,authorizeMembership,googleIdentityApproved,safeReturnPath} from '../src/server/auth/access-policy';
import {restrictedAdapter} from '../src/server/auth/restricted-adapter';
import {authErrorResponse,dataResponse} from '../src/server/http/envelope';

const id = '0123456789abcdef01234567';
const workspaceId = '10000000-0000-4000-8000-000000000001';
const allowed = new Set(['member@example.com']);
const env = {AUTH_SECRET:'test-only-secret-'.repeat(4),AUTH_URL:'http://127.0.0.1:3000',AUTH_GOOGLE_ID:'test-client.apps.googleusercontent.com',AUTH_GOOGLE_SECRET:'test-only-oauth-secret',TEAM_ALLOWED_EMAILS:' member@example.com ',MONGODB_URI:'mongodb://127.0.0.1:27017',MONGODB_DB:'test_database',WORKSPACE_ID:workspaceId,WORKSPACE_NAME:'Test workspace'};
const session = {user:{id,name:'Member',email:'member@example.com'},expires:new Date(Date.now()+60_000).toISOString()};

test('configuration fails closed for missing credentials and malformed allowlist; values are not in issue names',()=>{
  assert.equal(inspectAuthSettings({}).ready,false);
  assert.equal(inspectAuthSettings(env).ready,true);
  const report = inspectAuthSettings({...env,TEAM_ALLOWED_EMAILS:'member@example.com,@example.com'});
  assert.equal(report.settings,null);
  assert.deepEqual(report.issues,['TEAM_ALLOWED_EMAILS']);
  for (const key of ['AUTH_SECRET','AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET','TEAM_ALLOWED_EMAILS','MONGODB_URI'] as const) assert.equal(inspectAuthSettings({...env,[key]:''}).ready,false,key);
});

test('hosted auth requires HTTPS, disallows credential-bearing URLs and disabled database TLS',()=>{
  for (const url of ['http://public.example.com','https://user:pass@example.com','https://example.com?key=test','https://example.com/path']) assert.equal(inspectAuthSettings({...env,AUTH_URL:url}).ready,false);
  assert.equal(inspectAuthSettings({...env,AUTH_URL:'https://studio.example.com'}).ready,true);
  assert.equal(inspectAuthSettings({...env,MONGODB_URI:'mongodb://host/?tls=false'}).ready,false);
});

test('email matching is exact, normalized, and never a suffix or alias match',()=>{
  assert.equal(normalizeEmail(' MEMBER@Example.com '),'member@example.com');
  for (const email of ['member+other@example.com','other@example.com','member@example.com.evil.test']) assert.throws(()=>authorizeIdentity({...session,user:{...session.user,email}},allowed),/TEAM_ACCESS_DENIED/);
});

test('Google verification requires boolean verified claim, exact subject, provider and stored email',()=>{
  const identity = {provider:'google',subject:'subject-123',profile:{sub:'subject-123',email:'Member@example.com',email_verified:true},userEmail:'member@example.com'};
  assert.equal(googleIdentityApproved(identity,allowed),true);
  for (const email_verified of [false,undefined,'true',1]) assert.equal(googleIdentityApproved({...identity,profile:{...identity.profile,email_verified}},allowed),false);
  assert.equal(googleIdentityApproved({...identity,subject:'another-subject'},allowed),false);
  assert.equal(googleIdentityApproved({...identity,provider:'credentials'},allowed),false);
  assert.equal(googleIdentityApproved({...identity,userEmail:'other@example.com'},allowed),false);
});

test('missing, malformed and expired sessions are rejected before membership access',()=>{
  assert.throws(()=>authorizeIdentity(null,allowed),/AUTHENTICATION_REQUIRED/);
  assert.throws(()=>authorizeIdentity({...session,user:{...session.user,id:'client-chosen'}},allowed),/AUTHENTICATION_REQUIRED/);
  for (const expires of ['', 'not-a-date',new Date(0).toISOString()]) assert.throws(()=>authorizeIdentity({...session,expires},allowed),/SESSION_EXPIRED/);
  assert.throws(()=>authorizeIdentity(session,allowed,Date.parse(session.expires)),/SESSION_EXPIRED/);
});

test('allowlist removal is checked on the next authorization decision',()=>{
  assert.equal(authorizeIdentity(session,allowed).userId,id);
  assert.throws(()=>authorizeIdentity(session,new Set()),/TEAM_ACCESS_DENIED/);
});

test('membership authority is bound to current user/workspace/email and active status',()=>{
  const member = {userId:id,workspaceId,normalizedEmail:'member@example.com',status:'active'};
  assert.doesNotThrow(()=>authorizeMembership(member,id,'member@example.com',workspaceId));
  for (const candidate of [null,{...member,status:'disabled'},{...member,userId:'other'},{...member,workspaceId:'other'},{...member,normalizedEmail:'other@example.com'}]) assert.throws(()=>authorizeMembership(candidate,id,'member@example.com',workspaceId),/TEAM_ACCESS_DENIED/);
});

test('return paths reject external URLs, encoded slashes, query injection and unrelated internal actions',()=>{
  for (const path of ['/calendar','/settings','/projects',`/projects/${workspaceId}`]) assert.equal(safeReturnPath(path),path);
  for (const path of ['https://evil.test','//evil.test','/\\evil.test','/%2f%2fevil.test','/api/auth/signout','/calendar?token=test','/settings#secret',null,['/calendar']]) assert.equal(safeReturnPath(path),'/projects');
});

function adapterHarness(enroll: (userId:string,email:string)=>Promise<void> = async()=>{}) {
  let created: AdapterSession | undefined;
  let linked: Record<string,unknown> | undefined;
  let createdUser: unknown;
  let deadline = new Date(Date.now()+60_000);
  const user: AdapterUser = {id,email:'member@example.com',emailVerified:null,name:'Member'};
  const base: Adapter = {
    getUser:async()=>user,
    createUser:async(data)=>{createdUser=data;return {...data,id};},
    createSession:async(data)=>{created=data;return data;},
    getSessionAndUser:async()=>({user,session:{userId:id,sessionToken:'test-session-token',expires:deadline}}),
    linkAccount:async(data)=>{linked={...data};return data;},
  };
  return {adapter:restrictedAdapter(base,allowed,enroll),user,get created(){return created;},get linked(){return linked;},get createdUser(){return createdUser;},setDeadline:(value:Date)=>{deadline=value;}};
}

test('disabled enrollment cannot create a session and cannot be bypassed by another login',async()=>{
  const h=adapterHarness(async()=>{throw new AccessError('TEAM_ACCESS_DENIED');});
  await assert.rejects(async()=>h.adapter.createSession!({userId:id,sessionToken:'test-session-token',expires:new Date(Date.now()+60_000)}),/TEAM_ACCESS_DENIED/);
  assert.equal(h.created,undefined);
});

test('session enrollment uses stored identity and caps expiry at seven days',async()=>{
  const enrollment: string[][]=[];
  const h=adapterHarness(async(userId,email)=>{enrollment.push([userId,email]);});
  await h.adapter.createSession!({userId:id,sessionToken:'test-session-token',expires:new Date(Date.now()+30*86400_000)});
  assert.deepEqual(enrollment,[[id,'member@example.com']]);
  assert.ok(h.created!.expires.getTime()<=Date.now()+SESSION_SECONDS*1000);
  h.user.email='removed@example.com';
  await assert.rejects(async()=>h.adapter.createSession!({userId:id,sessionToken:'another-test-token',expires:new Date(Date.now()+60_000)}),/TEAM_ACCESS_DENIED/);
});

test('session refresh preserves the original absolute database deadline',async()=>{
  const h=adapterHarness();
  const original=new Date(Date.now()+60_000);h.setDeadline(original);
  const updated=await h.adapter.updateSession!({sessionToken:'test-session-token',expires:new Date(Date.now()+30*86400_000)});
  assert.equal(updated!.expires.getTime(),original.getTime());
  h.setDeadline(new Date(0));
  assert.equal(await h.adapter.updateSession!({sessionToken:'test-session-token'}),null);
});

test('Google account linking discards OAuth credentials and retains only identity keys',async()=>{
  const h=adapterHarness();
  await h.adapter.linkAccount!({userId:id,provider:'google',providerAccountId:'subject-123',type:'oidc',access_token:'test-access-value',refresh_token:'test-refresh-value',id_token:'test-id-value'});
  assert.deepEqual(h.linked,{userId:id,provider:'google',providerAccountId:'subject-123',type:'oidc'});
});

test('new user records discard remote avatars and unexpected identity fields',async()=>{
  const h=adapterHarness();
  await h.adapter.createUser!({id:'client-id',email:'MEMBER@example.com',name:'Member',emailVerified:new Date(),image:'https://external.example/avatar'});
  const created=h.createdUser as Record<string,unknown>;
  assert.match(created.id as string,/^[0-9a-f-]{36}$/);
  assert.notEqual(created.id,'client-id');
  assert.deepEqual({...created,id:undefined},{id:undefined,email:'member@example.com',name:'Member',image:null,emailVerified:null});
});

test('API errors sanitize unknown causes, preserve status and prevent private response caching',async()=>{
  for (const [code,status] of [['AUTHENTICATION_REQUIRED',401],['SESSION_EXPIRED',401],['TEAM_ACCESS_DENIED',403],['CONNECTION_UNAVAILABLE',503]] as const) {
    const response=authErrorResponse(new AccessError(code));
    assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');
    const body=await response.json();assert.equal(body.error.code,code);assert.ok(body.meta.requestId);assert.ok(body.meta.serverTime);
  }
  const response=authErrorResponse(new Error('private-connection-details'));
  assert.equal(response.status,500);assert.ok(!(await response.text()).includes('private-connection-details'));
  assert.equal(dataResponse({ok:true}).headers.get('vary'),'Cookie');
});
