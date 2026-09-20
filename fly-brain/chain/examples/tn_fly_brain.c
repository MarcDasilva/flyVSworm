/* fly_brain - see tn_fly_brain.h. Creates the brain and neuron accounts, and records one synapse
   per transaction: the accounts hold the current totals, the events hold every synapse ever added. */
#include <stddef.h>
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "tn_fly_brain.h"

/* An account this program owns, already created, of at least sz bytes. */
static void *
our_account_data( ushort account_idx, ulong sz ) {
  TSDK_ASSERT_OR_REVERT( tsdk_is_account_idx_valid( account_idx ), TN_FLY_ERR_ACCOUNT_MISSING );
  TSDK_ASSERT_OR_REVERT( tsdk_account_exists( account_idx ), TN_FLY_ERR_ACCOUNT_MISSING );
  TSDK_ASSERT_OR_REVERT( tsdk_is_account_owned_by_current_program( account_idx ), TN_FLY_ERR_ACCOUNT_NOT_OURS );
  tsdk_account_meta_t const * meta = tsdk_get_account_meta( account_idx );
  TSDK_ASSERT_OR_REVERT( meta != NULL && meta->data_sz >= sz, TN_FLY_ERR_ACCOUNT_DATA );
  TSDK_ASSERT_OR_REVERT( tsys_set_account_data_writable( account_idx )==TSDK_SUCCESS, TN_FLY_ERR_ACCOUNT_WRITABLE );
  void * data = tsdk_get_account_data_ptr( account_idx );
  TSDK_ASSERT_OR_REVERT( data != NULL, TN_FLY_ERR_ACCOUNT_DATA );
  return data;
}

/* Create a program-derived account of sz bytes at account_idx and return its (zeroed) data. */
static void *
create_account( ushort account_idx, uchar const * seed, uchar const * proof, uint proof_sz, ulong sz ) {
  TSDK_ASSERT_OR_REVERT( tsdk_is_account_idx_valid( account_idx ), TN_FLY_ERR_ACCOUNT_MISSING );
  TSDK_ASSERT_OR_REVERT( tsys_account_create( account_idx, seed, proof, proof_sz )==TSDK_SUCCESS,
                         TN_FLY_ERR_ACCOUNT_CREATE );
  TSDK_ASSERT_OR_REVERT( tsys_set_account_data_writable( account_idx )==TSDK_SUCCESS, TN_FLY_ERR_ACCOUNT_WRITABLE );
  TSDK_ASSERT_OR_REVERT( tsys_account_resize( account_idx, sz )==TSDK_SUCCESS, TN_FLY_ERR_ACCOUNT_RESIZE );
  void * data = tsdk_get_account_data_ptr( account_idx );
  TSDK_ASSERT_OR_REVERT( data != NULL, TN_FLY_ERR_ACCOUNT_DATA );
  return data;
}

static void
emit( void const * event, ulong sz ) {
  TSDK_ASSERT_OR_REVERT( tsys_emit_event( event, sz )==TSDK_SUCCESS, TN_FLY_ERR_EMIT_EVENT );
}

/* The brain account, with the caller proven to be the authority recorded when it was created:
   without this anyone could append neurons and synapses that an indexer would then replay. */
static tn_fly_brain_account_t *
brain_account( ushort account_idx ) {
  tn_fly_brain_account_t * brain =
      (tn_fly_brain_account_t *)our_account_data( account_idx, sizeof(tn_fly_brain_account_t) );
  TSDK_ASSERT_OR_REVERT( brain->version==TN_FLY_ACCOUNT_VERSION, TN_FLY_ERR_ACCOUNT_VERSION );
  TSDK_ASSERT_OR_REVERT( tsdk_is_account_authorized_by_pubkey( (tn_pubkey_t const *)brain->authority ),
                         TN_FLY_ERR_NOT_AUTHORITY );
  return brain;
}

static tn_fly_neuron_account_t *
neuron_account( ushort account_idx ) {
  tn_fly_neuron_account_t * neuron =
      (tn_fly_neuron_account_t *)our_account_data( account_idx, sizeof(tn_fly_neuron_account_t) );
  TSDK_ASSERT_OR_REVERT( neuron->version==TN_FLY_ACCOUNT_VERSION, TN_FLY_ERR_ACCOUNT_VERSION );
  return neuron;
}

static void
handle_create_brain( uchar const * instruction_data ) {
  tn_fly_create_brain_args_t const * args = (tn_fly_create_brain_args_t const *)instruction_data;
  /* The authority must sign its own appointment, or anyone could take this seed's address and
     name a key that only they can write with. */
  TSDK_ASSERT_OR_REVERT( tsdk_is_account_authorized_by_pubkey( (tn_pubkey_t const *)args->authority ),
                         TN_FLY_ERR_NOT_AUTHORITY );
  uchar const * proof = args->proof_size ? instruction_data + sizeof(tn_fly_create_brain_args_t) : NULL;
  tn_fly_brain_account_t * brain =
      (tn_fly_brain_account_t *)create_account( args->account_index, args->seed, proof, args->proof_size,
                                                sizeof(tn_fly_brain_account_t) );
  brain->version       = TN_FLY_ACCOUNT_VERSION;
  brain->kind          = TN_FLY_ACCOUNT_BRAIN;
  brain->pad[0] = brain->pad[1] = 0U;
  brain->neuron_count  = 0U;
  brain->synapse_count = 0U;
  brain->neuron_total  = args->neuron_total;
  brain->synapse_total = args->synapse_total;
  for( ulong i=0UL; i<32UL; i++ ) brain->manifest_sha256[i] = args->manifest_sha256[i];
  for( ulong i=0UL; i<32UL; i++ ) brain->authority[i]       = args->authority[i];

  tn_fly_brain_created_event_t ev;
  ev.version       = TN_FLY_EVENT_VERSION;
  ev.kind          = TN_FLY_EVENT_BRAIN_CREATED;
  ev.neuron_total  = args->neuron_total;
  ev.synapse_total = args->synapse_total;
  for( ulong i=0UL; i<32UL; i++ ) ev.manifest_sha256[i] = args->manifest_sha256[i];
  emit( &ev, sizeof(ev) );
  tsdk_return( TSDK_SUCCESS );
}

static void
handle_create_neuron( uchar const * instruction_data ) {
  tn_fly_create_neuron_args_t const * args = (tn_fly_create_neuron_args_t const *)instruction_data;
  TSDK_ASSERT_OR_REVERT( args->cls<=TN_FLY_CLS_MAX, TN_FLY_ERR_BAD_NEURON );
  TSDK_ASSERT_OR_REVERT( args->wedge>=(tn_schar)-1 && args->wedge<(tn_schar)16, TN_FLY_ERR_BAD_NEURON );
  TSDK_ASSERT_OR_REVERT( args->sign==(tn_schar)1 || args->sign==(tn_schar)-1, TN_FLY_ERR_BAD_NEURON );
  tn_fly_brain_account_t * brain = brain_account( args->brain_index );
  TSDK_ASSERT_OR_REVERT( brain->neuron_count < brain->neuron_total, TN_FLY_ERR_TOO_MANY );
  /* The row index makes a retried transaction revert instead of recording the neuron twice. */
  TSDK_ASSERT_OR_REVERT( args->index==brain->neuron_count, TN_FLY_ERR_WRONG_INDEX );

  uchar const * proof = args->proof_size ? instruction_data + sizeof(tn_fly_create_neuron_args_t) : NULL;
  tn_fly_neuron_account_t * neuron =
      (tn_fly_neuron_account_t *)create_account( args->account_index, args->seed, proof, args->proof_size,
                                                 sizeof(tn_fly_neuron_account_t) );
  neuron->version   = TN_FLY_ACCOUNT_VERSION;
  neuron->kind      = TN_FLY_ACCOUNT_NEURON;
  neuron->pad[0] = neuron->pad[1] = neuron->pad[2] = 0U;
  neuron->cls       = args->cls;
  neuron->wedge     = args->wedge;
  neuron->sign      = args->sign;
  neuron->out_count = 0U;
  neuron->in_count  = 0U;
  neuron->body_id   = args->body_id;
  brain->neuron_count++;

  tn_fly_neuron_created_event_t ev;
  ev.version = TN_FLY_EVENT_VERSION;
  ev.kind    = TN_FLY_EVENT_NEURON_CREATED;
  ev.cls     = args->cls;
  ev.wedge   = args->wedge;
  ev.sign    = args->sign;
  ev.pad[0] = ev.pad[1] = ev.pad[2] = 0U;
  ev.body_id = args->body_id;
  emit( &ev, sizeof(ev) );
  tsdk_return( TSDK_SUCCESS );
}

static void
handle_add_synapse( uchar const * instruction_data ) {
  tn_fly_add_synapse_args_t const * args = (tn_fly_add_synapse_args_t const *)instruction_data;
  tn_fly_brain_account_t * brain = brain_account( args->brain_index );
  TSDK_ASSERT_OR_REVERT( brain->synapse_count < brain->synapse_total, TN_FLY_ERR_TOO_MANY );
  TSDK_ASSERT_OR_REVERT( args->index==brain->synapse_count, TN_FLY_ERR_WRONG_INDEX );

  tn_fly_neuron_account_t * pre = neuron_account( args->pre_index );
  /* Bind the row to its neurons: the accounts passed must be the ones the manifest row names. */
  TSDK_ASSERT_OR_REVERT( pre->body_id==args->pre_body_id, TN_FLY_ERR_BAD_NEURON );
  tn_fly_synapse_added_event_t ev;
  ev.version      = TN_FLY_EVENT_VERSION;
  ev.kind         = TN_FLY_EVENT_SYNAPSE_ADDED;
  for( ulong i=0UL; i<6UL; i++ ) ev.pad[i] = 0U;
  ev.pre_body_id  = pre->body_id;
  pre->out_count++;
  /* A neuron may synapse onto itself; take the post pointer after the pre update so both land. */
  tn_fly_neuron_account_t * post = neuron_account( args->post_index );
  TSDK_ASSERT_OR_REVERT( post->body_id==args->post_body_id, TN_FLY_ERR_BAD_NEURON );
  ev.post_body_id = post->body_id;
  post->in_count++;
  for( ulong i=0UL; i<3UL; i++ ) {
    ev.pre_xyz[i]  = args->pre_xyz[i];
    ev.post_xyz[i] = args->post_xyz[i];
  }
  brain->synapse_count++;
  emit( &ev, sizeof(ev) );
  tsdk_return( TSDK_SUCCESS );
}

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data, ulong instruction_data_sz ) {
  uchar const * data = (uchar const *)instruction_data;
  TSDK_ASSERT_OR_REVERT( instruction_data_sz>=sizeof(uint), TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
  uint instruction_type = TSDK_LOAD( uint, data );

  switch( instruction_type ) {
    case TN_FLY_INSTRUCTION_CREATE_BRAIN: {
      TSDK_ASSERT_OR_REVERT( instruction_data_sz>=sizeof(tn_fly_create_brain_args_t),
                             TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
      tn_fly_create_brain_args_t const * args = (tn_fly_create_brain_args_t const *)data;
      TSDK_ASSERT_OR_REVERT( instruction_data_sz==sizeof(tn_fly_create_brain_args_t)+args->proof_size,
                             TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
      handle_create_brain( data );
      break;
    }
    case TN_FLY_INSTRUCTION_CREATE_NEURON: {
      TSDK_ASSERT_OR_REVERT( instruction_data_sz>=sizeof(tn_fly_create_neuron_args_t),
                             TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
      tn_fly_create_neuron_args_t const * args = (tn_fly_create_neuron_args_t const *)data;
      TSDK_ASSERT_OR_REVERT( instruction_data_sz==sizeof(tn_fly_create_neuron_args_t)+args->proof_size,
                             TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
      handle_create_neuron( data );
      break;
    }
    case TN_FLY_INSTRUCTION_ADD_SYNAPSE:
      TSDK_ASSERT_OR_REVERT( instruction_data_sz==sizeof(tn_fly_add_synapse_args_t),
                             TN_FLY_ERR_INSTRUCTION_DATA_SIZE );
      handle_add_synapse( data );
      break;
    default:
      tsdk_revert( TN_FLY_ERR_INSTRUCTION_TYPE );
  }
  tsdk_revert( TN_FLY_ERR_INSTRUCTION_TYPE );
}
