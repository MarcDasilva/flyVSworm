#include <stdint.h> /* for uint8_t, int64_t, etc. */
#include <stddef.h> /* for offsetof */
#include <stdlib.h> /* for malloc */
#include <string.h> /* for memcpy */
#include <assert.h> /* for assert */
#include <stdio.h> /* for fprintf */
#include "types.h" /* for type definitions */

/* Checked arithmetic helpers */
static inline int tn_checked_add_u64( uint64_t a,
uint64_t b,
uint64_t * out ) {
if( !out ) return 1;
if( a > UINT64_MAX - b ) return 1;
*out = a + b;
return 0;
}

static inline int tn_checked_mul_u64( uint64_t a,
uint64_t b,
uint64_t * out ) {
if( !out ) return 1;
if( a && b > UINT64_MAX / a ) return 1;
*out = a * b;
return 0;
}

/*  ----- FUNCTIONS FOR AddSynapseArgs ----- */

uint64_t AddSynapseArgs_footprint( void ) {
  return AddSynapseArgs_footprint_ir();
}

/* IR footprint generated for AddSynapseArgs */
uint64_t AddSynapseArgs_footprint_ir( void ) {
    return 52ULL;
}
/* IR validator generated for AddSynapseArgs */
int AddSynapseArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 52ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

AddSynapseArgs_t const * AddSynapseArgs_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( AddSynapseArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (AddSynapseArgs_t const *)data;
}

AddSynapseArgs_t * AddSynapseArgs_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( AddSynapseArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (AddSynapseArgs_t *)data;
}

int AddSynapseArgs_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 2; /* brain_index */
    required_size += 2; /* pre_index */
    required_size += 2; /* post_index */
    required_size += 2; /* pad */
    required_size += 4; /* index */
    required_size += 8; /* pre_body_id */
    required_size += 8; /* post_body_id */
    required_size += 12; /* pre_xyz (array) */
    required_size += 12; /* post_xyz (array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 2;

    offset += 2;

    offset += 2;

    offset += 2;

    offset += 4;

    offset += 8;

    offset += 8;

    offset += 12; /* skip array 'pre_xyz' (set via setters) */

    offset += 12; /* skip array 'post_xyz' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint16_t AddSynapseArgs_get_brain_index( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint16_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

uint16_t AddSynapseArgs_get_pre_index( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    return ({ uint16_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint16_t AddSynapseArgs_get_post_index( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    return ({ uint16_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint16_t AddSynapseArgs_get_pad( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    return ({ uint16_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t AddSynapseArgs_get_index( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint64_t AddSynapseArgs_get_pre_body_id( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint64_t AddSynapseArgs_get_post_body_id( AddSynapseArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for pre_xyz */
uint64_t AddSynapseArgs_get_pre_xyz_length( AddSynapseArgs_t const * self ) {
    return 3;
}

int32_t AddSynapseArgs_get_pre_xyz_at( AddSynapseArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += index * 4; /* element index */
    return ({ int32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for post_xyz */
uint64_t AddSynapseArgs_get_post_xyz_length( AddSynapseArgs_t const * self ) {
    return 3;
}

int32_t AddSynapseArgs_get_post_xyz_at( AddSynapseArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += 12; /* pre_xyz (array) */
    offset += index * 4; /* element index */
    return ({ int32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

void AddSynapseArgs_set_brain_index( AddSynapseArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    memcpy( &data[0], &value, sizeof( value ) );
}

void AddSynapseArgs_set_pre_index( AddSynapseArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_post_index( AddSynapseArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_pad( AddSynapseArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_index( AddSynapseArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_pre_body_id( AddSynapseArgs_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_post_body_id( AddSynapseArgs_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_pre_xyz_at( AddSynapseArgs_t * self, uint64_t index, int32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += index * 4; /* element index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void AddSynapseArgs_set_post_xyz_at( AddSynapseArgs_t * self, uint64_t index, int32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* pre_index */
    offset += 2; /* post_index */
    offset += 2; /* pad */
    offset += 4; /* index */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += 12; /* pre_xyz (array) */
    offset += index * 4; /* element index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

int AddSynapseArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'brain_index' */
    }
    offset += 2; /* brain_index */

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'pre_index' */
    }
    offset += 2; /* pre_index */

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'post_index' */
    }
    offset += 2; /* post_index */

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'pad' */
    }
    offset += 2; /* pad */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'index' */
    }
    offset += 4; /* index */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'pre_body_id' */
    }
    offset += 8; /* pre_body_id */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'post_body_id' */
    }
    offset += 8; /* post_body_id */

    if( offset + 12 > data_len ) {
        return -1; /* Buffer too small for array 'pre_xyz' */
    }
    offset += 12; /* pre_xyz (array) */

    if( offset + 12 > data_len ) {
        return -1; /* Buffer too small for array 'post_xyz' */
    }
    offset += 12; /* post_xyz (array) */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR BrainAccountBody ----- */

uint64_t BrainAccountBody_footprint( void ) {
  return BrainAccountBody_footprint_ir();
}

/* IR footprint generated for BrainAccountBody */
uint64_t BrainAccountBody_footprint_ir( void ) {
    return 82ULL;
}
/* IR validator generated for BrainAccountBody */
int BrainAccountBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 82ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

BrainAccountBody_t const * BrainAccountBody_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( BrainAccountBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (BrainAccountBody_t const *)data;
}

BrainAccountBody_t * BrainAccountBody_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( BrainAccountBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (BrainAccountBody_t *)data;
}

int BrainAccountBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 2; /* pad (array) */
    required_size += 4; /* neuron_count */
    required_size += 4; /* synapse_count */
    required_size += 4; /* neuron_total */
    required_size += 4; /* synapse_total */
    required_size += 32; /* manifest_sha256 (array) */
    required_size += 32; /* authority (array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 2; /* skip array 'pad' (set via setters) */

    offset += 4;

    offset += 4;

    offset += 4;

    offset += 4;

    offset += 32; /* skip array 'manifest_sha256' (set via setters) */

    offset += 32; /* skip array 'authority' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

/* Array accessor helpers for pad */
uint64_t BrainAccountBody_get_pad_length( BrainAccountBody_t const * self ) {
    return 2;
}

uint8_t BrainAccountBody_get_pad_at( BrainAccountBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = index * 1;
    return data[offset];
}

uint32_t BrainAccountBody_get_neuron_count( BrainAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t BrainAccountBody_get_synapse_count( BrainAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t BrainAccountBody_get_neuron_total( BrainAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t BrainAccountBody_get_synapse_total( BrainAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for manifest_sha256 */
uint64_t BrainAccountBody_get_manifest_sha256_length( BrainAccountBody_t const * self ) {
    return 32;
}

uint8_t BrainAccountBody_get_manifest_sha256_at( BrainAccountBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += index * 1; /* element index */
    return data[offset];
}

/* Array accessor helpers for authority */
uint64_t BrainAccountBody_get_authority_length( BrainAccountBody_t const * self ) {
    return 32;
}

uint8_t BrainAccountBody_get_authority_at( BrainAccountBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += 32; /* manifest_sha256 (array) */
    offset += index * 1; /* element index */
    return data[offset];
}

void BrainAccountBody_set_pad_at( BrainAccountBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = index * 1;
    data[offset] = value;
}

void BrainAccountBody_set_neuron_count( BrainAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void BrainAccountBody_set_synapse_count( BrainAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void BrainAccountBody_set_neuron_total( BrainAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void BrainAccountBody_set_synapse_total( BrainAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void BrainAccountBody_set_manifest_sha256_at( BrainAccountBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void BrainAccountBody_set_authority_at( BrainAccountBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* pad (array) */
    offset += 4; /* neuron_count */
    offset += 4; /* synapse_count */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += 32; /* manifest_sha256 (array) */
    offset += index * 1; /* element index */
    data[offset] = value;
}

int BrainAccountBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for array 'pad' */
    }
    offset += 2; /* pad (array) */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'neuron_count' */
    }
    offset += 4; /* neuron_count */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'synapse_count' */
    }
    offset += 4; /* synapse_count */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'neuron_total' */
    }
    offset += 4; /* neuron_total */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'synapse_total' */
    }
    offset += 4; /* synapse_total */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'manifest_sha256' */
    }
    offset += 32; /* manifest_sha256 (array) */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'authority' */
    }
    offset += 32; /* authority (array) */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR BrainCreatedBody ----- */

uint64_t BrainCreatedBody_footprint( void ) {
  return BrainCreatedBody_footprint_ir();
}

/* IR footprint generated for BrainCreatedBody */
uint64_t BrainCreatedBody_footprint_ir( void ) {
    return 40ULL;
}
/* IR validator generated for BrainCreatedBody */
int BrainCreatedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 40ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

BrainCreatedBody_t const * BrainCreatedBody_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( BrainCreatedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (BrainCreatedBody_t const *)data;
}

BrainCreatedBody_t * BrainCreatedBody_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( BrainCreatedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (BrainCreatedBody_t *)data;
}

int BrainCreatedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 4; /* neuron_total */
    required_size += 4; /* synapse_total */
    required_size += 32; /* manifest_sha256 (array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 4;

    offset += 4;

    offset += 32; /* skip array 'manifest_sha256' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint32_t BrainCreatedBody_get_neuron_total( BrainCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint32_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

uint32_t BrainCreatedBody_get_synapse_total( BrainCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 4; /* neuron_total */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for manifest_sha256 */
uint64_t BrainCreatedBody_get_manifest_sha256_length( BrainCreatedBody_t const * self ) {
    return 32;
}

uint8_t BrainCreatedBody_get_manifest_sha256_at( BrainCreatedBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += index * 1; /* element index */
    return data[offset];
}

void BrainCreatedBody_set_neuron_total( BrainCreatedBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    memcpy( &data[0], &value, sizeof( value ) );
}

void BrainCreatedBody_set_synapse_total( BrainCreatedBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 4; /* neuron_total */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void BrainCreatedBody_set_manifest_sha256_at( BrainCreatedBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += index * 1; /* element index */
    data[offset] = value;
}

int BrainCreatedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'neuron_total' */
    }
    offset += 4; /* neuron_total */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'synapse_total' */
    }
    offset += 4; /* synapse_total */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'manifest_sha256' */
    }
    offset += 32; /* manifest_sha256 (array) */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR CreateBrainArgs ----- */

uint64_t CreateBrainArgs_footprint( int64_t proof_size ) {
  return CreateBrainArgs_footprint_ir( (uint64_t)proof_size );
}

/* IR footprint generated for CreateBrainArgs */
uint64_t CreateBrainArgs_footprint_ir( uint64_t proof_proof_size ) {
    return (((((((((((((2ULL) + 2ULL - 1ULL) & ~(2ULL - 1ULL)) + (((32ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((32ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((32ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL))) + (((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL))) + (((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL))) + ((((proof_proof_size * 1ULL)) + 1ULL - 1ULL) & ~(1ULL - 1ULL)))) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
}
/* IR validator generated for CreateBrainArgs */
int CreateBrainArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t proof_proof_size ) {
  uint64_t tn_val_0 = 2ULL;
  uint64_t tn_val_1 = tn_val_0;
  uint64_t tn_val_2 = tn_val_1 % 2ULL;
  if( tn_val_2 ) {
    uint64_t tn_val_3 = 2ULL - tn_val_2;
    if( tn_checked_add_u64( tn_val_1, tn_val_3, &tn_val_1 ) ) return 3;
  }
  uint64_t tn_val_4 = 32ULL;
  uint64_t tn_val_5 = 0ULL;
  if( tn_checked_add_u64( tn_val_1, tn_val_4, &tn_val_5 ) ) return 3;
  uint64_t tn_val_6 = 32ULL;
  uint64_t tn_val_7 = 0ULL;
  if( tn_checked_add_u64( tn_val_5, tn_val_6, &tn_val_7 ) ) return 3;
  uint64_t tn_val_8 = 32ULL;
  uint64_t tn_val_9 = 0ULL;
  if( tn_checked_add_u64( tn_val_7, tn_val_8, &tn_val_9 ) ) return 3;
  uint64_t tn_val_10 = 4ULL;
  uint64_t tn_val_11 = tn_val_10;
  uint64_t tn_val_12 = tn_val_11 % 4ULL;
  if( tn_val_12 ) {
    uint64_t tn_val_13 = 4ULL - tn_val_12;
    if( tn_checked_add_u64( tn_val_11, tn_val_13, &tn_val_11 ) ) return 3;
  }
  uint64_t tn_val_14 = 0ULL;
  if( tn_checked_add_u64( tn_val_9, tn_val_11, &tn_val_14 ) ) return 3;
  uint64_t tn_val_15 = 4ULL;
  uint64_t tn_val_16 = tn_val_15;
  uint64_t tn_val_17 = tn_val_16 % 4ULL;
  if( tn_val_17 ) {
    uint64_t tn_val_18 = 4ULL - tn_val_17;
    if( tn_checked_add_u64( tn_val_16, tn_val_18, &tn_val_16 ) ) return 3;
  }
  uint64_t tn_val_19 = 0ULL;
  if( tn_checked_add_u64( tn_val_14, tn_val_16, &tn_val_19 ) ) return 3;
  uint64_t tn_val_20 = 4ULL;
  uint64_t tn_val_21 = tn_val_20;
  uint64_t tn_val_22 = tn_val_21 % 4ULL;
  if( tn_val_22 ) {
    uint64_t tn_val_23 = 4ULL - tn_val_22;
    if( tn_checked_add_u64( tn_val_21, tn_val_23, &tn_val_21 ) ) return 3;
  }
  uint64_t tn_val_24 = 0ULL;
  if( tn_checked_add_u64( tn_val_19, tn_val_21, &tn_val_24 ) ) return 3;
  uint64_t tn_val_25 = 1ULL;
  uint64_t tn_val_26 = 0ULL;
  if( tn_checked_mul_u64( proof_proof_size, tn_val_25, &tn_val_26 ) ) return 3;
  uint64_t tn_val_27 = 0ULL;
  if( tn_checked_add_u64( tn_val_24, tn_val_26, &tn_val_27 ) ) return 3;
  if( tn_val_27 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_27;
  return 0;
}

CreateBrainArgs_t const * CreateBrainArgs_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( CreateBrainArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (CreateBrainArgs_t const *)data;
}

CreateBrainArgs_t * CreateBrainArgs_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( CreateBrainArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (CreateBrainArgs_t *)data;
}

int CreateBrainArgs_new( uint8_t * buffer, uint64_t buffer_size, uint32_t proof_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 2; /* account_index */
    required_size += 32; /* seed (array) */
    required_size += 32; /* manifest_sha256 (array) */
    required_size += 32; /* authority (array) */
    required_size += 4; /* neuron_total */
    required_size += 4; /* synapse_total */
    required_size += 4; /* proof_size */
    required_size += (proof_size) * 1; /* proof (variable array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 2;

    offset += 32; /* skip array 'seed' (set via setters) */

    offset += 32; /* skip array 'manifest_sha256' (set via setters) */

    offset += 32; /* skip array 'authority' (set via setters) */

    offset += 4;

    offset += 4;

    memcpy( &buffer[offset], &proof_size, sizeof( proof_size ) );
    offset += 4;

    offset += (proof_size) * 1; /* skip variable array 'proof' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint16_t CreateBrainArgs_get_account_index( CreateBrainArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint16_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

/* Array accessor helpers for seed */
uint64_t CreateBrainArgs_get_seed_length( CreateBrainArgs_t const * self ) {
    return 32;
}

uint8_t CreateBrainArgs_get_seed_at( CreateBrainArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += index * 1; /* element index */
    return data[offset];
}

/* Array accessor helpers for manifest_sha256 */
uint64_t CreateBrainArgs_get_manifest_sha256_length( CreateBrainArgs_t const * self ) {
    return 32;
}

uint8_t CreateBrainArgs_get_manifest_sha256_at( CreateBrainArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += index * 1; /* element index */
    return data[offset];
}

/* Array accessor helpers for authority */
uint64_t CreateBrainArgs_get_authority_length( CreateBrainArgs_t const * self ) {
    return 32;
}

uint8_t CreateBrainArgs_get_authority_at( CreateBrainArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += index * 1; /* element index */
    return data[offset];
}

uint32_t CreateBrainArgs_get_neuron_total( CreateBrainArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t CreateBrainArgs_get_synapse_total( CreateBrainArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t CreateBrainArgs_get_proof_size( CreateBrainArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Variable-size array accessor helpers for proof */
uint64_t CreateBrainArgs_get_proof_length( CreateBrainArgs_t const * self ) {
    return (CreateBrainArgs_get_proof_size( self ));
}

uint8_t CreateBrainArgs_get_proof_at( CreateBrainArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t base_offset = 0;
    base_offset += 2; /* account_index */
    base_offset += 32; /* seed (array) */
    base_offset += 32; /* manifest_sha256 (array) */
    base_offset += 32; /* authority (array) */
    base_offset += 4; /* neuron_total */
    base_offset += 4; /* synapse_total */
    base_offset += 4; /* proof_size */
    uint64_t offset = base_offset + index * 1; /* element index */
    return data[offset];
}

uint8_t const * CreateBrainArgs_get_proof_const( CreateBrainArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += 4; /* proof_size */
    return &data[offset];
}

void CreateBrainArgs_set_account_index( CreateBrainArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    memcpy( &data[0], &value, sizeof( value ) );
}

void CreateBrainArgs_set_seed_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void CreateBrainArgs_set_manifest_sha256_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void CreateBrainArgs_set_authority_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void CreateBrainArgs_set_neuron_total( CreateBrainArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateBrainArgs_set_synapse_total( CreateBrainArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateBrainArgs_set_proof_size( CreateBrainArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateBrainArgs_set_proof_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t base_offset = 0;
    base_offset += 2; /* account_index */
    base_offset += 32; /* seed (array) */
    base_offset += 32; /* manifest_sha256 (array) */
    base_offset += 32; /* authority (array) */
    base_offset += 4; /* neuron_total */
    base_offset += 4; /* synapse_total */
    base_offset += 4; /* proof_size */
    uint64_t offset = base_offset + index * 1;
    data[offset] = value;
}

void CreateBrainArgs_set_proof( uint8_t * data, uint8_t const * slice, uint64_t slice_len ) {
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += 4; /* proof_size */
    uint64_t len = CreateBrainArgs_get_proof_length( (CreateBrainArgs_t const *)data );
    if( slice_len < len ) len = slice_len;
    memcpy( &data[offset], slice, len );
}

uint8_t * CreateBrainArgs_get_proof( uint8_t * data ) {
    uint64_t offset = 0;
    offset += 2; /* account_index */
    offset += 32; /* seed (array) */
    offset += 32; /* manifest_sha256 (array) */
    offset += 32; /* authority (array) */
    offset += 4; /* neuron_total */
    offset += 4; /* synapse_total */
    offset += 4; /* proof_size */
    return &data[offset];
}

int CreateBrainArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'account_index' */
    }
    offset += 2; /* account_index */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'seed' */
    }
    offset += 32; /* seed (array) */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'manifest_sha256' */
    }
    offset += 32; /* manifest_sha256 (array) */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'authority' */
    }
    offset += 32; /* authority (array) */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'neuron_total' */
    }
    offset += 4; /* neuron_total */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'synapse_total' */
    }
    offset += 4; /* synapse_total */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'proof_size' */
    }
    uint64_t offset_proof_size = offset;
    offset += 4; /* proof_size */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR CreateNeuronArgs ----- */

uint64_t CreateNeuronArgs_footprint( int64_t proof_size ) {
  return CreateNeuronArgs_footprint_ir( (uint64_t)proof_size );
}

/* IR footprint generated for CreateNeuronArgs */
uint64_t CreateNeuronArgs_footprint_ir( uint64_t proof_proof_size ) {
    return ((((((((((((((((2ULL) + 2ULL - 1ULL) & ~(2ULL - 1ULL)) + (((2ULL) + 2ULL - 1ULL) & ~(2ULL - 1ULL))) + (((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL))) + (((32ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((8ULL) + 8ULL - 1ULL) & ~(8ULL - 1ULL))) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL))) + ((((proof_proof_size * 1ULL)) + 1ULL - 1ULL) & ~(1ULL - 1ULL)))) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
}
/* IR validator generated for CreateNeuronArgs */
int CreateNeuronArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t proof_proof_size ) {
  uint64_t tn_val_0 = 2ULL;
  uint64_t tn_val_1 = tn_val_0;
  uint64_t tn_val_2 = tn_val_1 % 2ULL;
  if( tn_val_2 ) {
    uint64_t tn_val_3 = 2ULL - tn_val_2;
    if( tn_checked_add_u64( tn_val_1, tn_val_3, &tn_val_1 ) ) return 3;
  }
  uint64_t tn_val_4 = 2ULL;
  uint64_t tn_val_5 = tn_val_4;
  uint64_t tn_val_6 = tn_val_5 % 2ULL;
  if( tn_val_6 ) {
    uint64_t tn_val_7 = 2ULL - tn_val_6;
    if( tn_checked_add_u64( tn_val_5, tn_val_7, &tn_val_5 ) ) return 3;
  }
  uint64_t tn_val_8 = 0ULL;
  if( tn_checked_add_u64( tn_val_1, tn_val_5, &tn_val_8 ) ) return 3;
  uint64_t tn_val_9 = 4ULL;
  uint64_t tn_val_10 = tn_val_9;
  uint64_t tn_val_11 = tn_val_10 % 4ULL;
  if( tn_val_11 ) {
    uint64_t tn_val_12 = 4ULL - tn_val_11;
    if( tn_checked_add_u64( tn_val_10, tn_val_12, &tn_val_10 ) ) return 3;
  }
  uint64_t tn_val_13 = 0ULL;
  if( tn_checked_add_u64( tn_val_8, tn_val_10, &tn_val_13 ) ) return 3;
  uint64_t tn_val_14 = 32ULL;
  uint64_t tn_val_15 = 0ULL;
  if( tn_checked_add_u64( tn_val_13, tn_val_14, &tn_val_15 ) ) return 3;
  uint64_t tn_val_16 = 8ULL;
  uint64_t tn_val_17 = tn_val_16;
  uint64_t tn_val_18 = tn_val_17 % 8ULL;
  if( tn_val_18 ) {
    uint64_t tn_val_19 = 8ULL - tn_val_18;
    if( tn_checked_add_u64( tn_val_17, tn_val_19, &tn_val_17 ) ) return 3;
  }
  uint64_t tn_val_20 = 0ULL;
  if( tn_checked_add_u64( tn_val_15, tn_val_17, &tn_val_20 ) ) return 3;
  uint64_t tn_val_21 = 1ULL;
  uint64_t tn_val_22 = 0ULL;
  if( tn_checked_add_u64( tn_val_20, tn_val_21, &tn_val_22 ) ) return 3;
  uint64_t tn_val_23 = 1ULL;
  uint64_t tn_val_24 = 0ULL;
  if( tn_checked_add_u64( tn_val_22, tn_val_23, &tn_val_24 ) ) return 3;
  uint64_t tn_val_25 = 1ULL;
  uint64_t tn_val_26 = 0ULL;
  if( tn_checked_add_u64( tn_val_24, tn_val_25, &tn_val_26 ) ) return 3;
  uint64_t tn_val_27 = 1ULL;
  uint64_t tn_val_28 = 0ULL;
  if( tn_checked_add_u64( tn_val_26, tn_val_27, &tn_val_28 ) ) return 3;
  uint64_t tn_val_29 = 4ULL;
  uint64_t tn_val_30 = tn_val_29;
  uint64_t tn_val_31 = tn_val_30 % 4ULL;
  if( tn_val_31 ) {
    uint64_t tn_val_32 = 4ULL - tn_val_31;
    if( tn_checked_add_u64( tn_val_30, tn_val_32, &tn_val_30 ) ) return 3;
  }
  uint64_t tn_val_33 = 0ULL;
  if( tn_checked_add_u64( tn_val_28, tn_val_30, &tn_val_33 ) ) return 3;
  uint64_t tn_val_34 = 1ULL;
  uint64_t tn_val_35 = 0ULL;
  if( tn_checked_mul_u64( proof_proof_size, tn_val_34, &tn_val_35 ) ) return 3;
  uint64_t tn_val_36 = 0ULL;
  if( tn_checked_add_u64( tn_val_33, tn_val_35, &tn_val_36 ) ) return 3;
  if( tn_val_36 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_36;
  return 0;
}

CreateNeuronArgs_t const * CreateNeuronArgs_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( CreateNeuronArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (CreateNeuronArgs_t const *)data;
}

CreateNeuronArgs_t * CreateNeuronArgs_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( CreateNeuronArgs_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (CreateNeuronArgs_t *)data;
}

int CreateNeuronArgs_new( uint8_t * buffer, uint64_t buffer_size, uint32_t proof_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 2; /* brain_index */
    required_size += 2; /* account_index */
    required_size += 4; /* index */
    required_size += 32; /* seed (array) */
    required_size += 8; /* body_id */
    required_size += 1; /* cls */
    required_size += 1; /* wedge */
    required_size += 1; /* sign */
    required_size += 1; /* pad */
    required_size += 4; /* proof_size */
    required_size += (proof_size) * 1; /* proof (variable array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 2;

    offset += 2;

    offset += 4;

    offset += 32; /* skip array 'seed' (set via setters) */

    offset += 8;

    offset += 1;

    offset += 1;

    offset += 1;

    offset += 1;

    memcpy( &buffer[offset], &proof_size, sizeof( proof_size ) );
    offset += 4;

    offset += (proof_size) * 1; /* skip variable array 'proof' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint16_t CreateNeuronArgs_get_brain_index( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint16_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

uint16_t CreateNeuronArgs_get_account_index( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    return ({ uint16_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t CreateNeuronArgs_get_index( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for seed */
uint64_t CreateNeuronArgs_get_seed_length( CreateNeuronArgs_t const * self ) {
    return 32;
}

uint8_t CreateNeuronArgs_get_seed_at( CreateNeuronArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += index * 1; /* element index */
    return data[offset];
}

uint64_t CreateNeuronArgs_get_body_id( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint8_t CreateNeuronArgs_get_cls( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    return data[offset];
}

int8_t CreateNeuronArgs_get_wedge( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    return (int8_t)data[offset];
}

int8_t CreateNeuronArgs_get_sign( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    return (int8_t)data[offset];
}

uint8_t CreateNeuronArgs_get_pad( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    return data[offset];
}

uint32_t CreateNeuronArgs_get_proof_size( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 1; /* pad */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Variable-size array accessor helpers for proof */
uint64_t CreateNeuronArgs_get_proof_length( CreateNeuronArgs_t const * self ) {
    return (CreateNeuronArgs_get_proof_size( self ));
}

uint8_t CreateNeuronArgs_get_proof_at( CreateNeuronArgs_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t base_offset = 0;
    base_offset += 2; /* brain_index */
    base_offset += 2; /* account_index */
    base_offset += 4; /* index */
    base_offset += 32; /* seed (array) */
    base_offset += 8; /* body_id */
    base_offset += 1; /* cls */
    base_offset += 1; /* wedge */
    base_offset += 1; /* sign */
    base_offset += 1; /* pad */
    base_offset += 4; /* proof_size */
    uint64_t offset = base_offset + index * 1; /* element index */
    return data[offset];
}

uint8_t const * CreateNeuronArgs_get_proof_const( CreateNeuronArgs_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 1; /* pad */
    offset += 4; /* proof_size */
    return &data[offset];
}

void CreateNeuronArgs_set_brain_index( CreateNeuronArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    memcpy( &data[0], &value, sizeof( value ) );
}

void CreateNeuronArgs_set_account_index( CreateNeuronArgs_t * self, uint16_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateNeuronArgs_set_index( CreateNeuronArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateNeuronArgs_set_seed_at( CreateNeuronArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void CreateNeuronArgs_set_body_id( CreateNeuronArgs_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateNeuronArgs_set_cls( CreateNeuronArgs_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    data[offset] = value;
}

void CreateNeuronArgs_set_wedge( CreateNeuronArgs_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    data[offset] = value;
}

void CreateNeuronArgs_set_sign( CreateNeuronArgs_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    data[offset] = value;
}

void CreateNeuronArgs_set_pad( CreateNeuronArgs_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    data[offset] = value;
}

void CreateNeuronArgs_set_proof_size( CreateNeuronArgs_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 1; /* pad */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void CreateNeuronArgs_set_proof_at( CreateNeuronArgs_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t base_offset = 0;
    base_offset += 2; /* brain_index */
    base_offset += 2; /* account_index */
    base_offset += 4; /* index */
    base_offset += 32; /* seed (array) */
    base_offset += 8; /* body_id */
    base_offset += 1; /* cls */
    base_offset += 1; /* wedge */
    base_offset += 1; /* sign */
    base_offset += 1; /* pad */
    base_offset += 4; /* proof_size */
    uint64_t offset = base_offset + index * 1;
    data[offset] = value;
}

void CreateNeuronArgs_set_proof( uint8_t * data, uint8_t const * slice, uint64_t slice_len ) {
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 1; /* pad */
    offset += 4; /* proof_size */
    uint64_t len = CreateNeuronArgs_get_proof_length( (CreateNeuronArgs_t const *)data );
    if( slice_len < len ) len = slice_len;
    memcpy( &data[offset], slice, len );
}

uint8_t * CreateNeuronArgs_get_proof( uint8_t * data ) {
    uint64_t offset = 0;
    offset += 2; /* brain_index */
    offset += 2; /* account_index */
    offset += 4; /* index */
    offset += 32; /* seed (array) */
    offset += 8; /* body_id */
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 1; /* pad */
    offset += 4; /* proof_size */
    return &data[offset];
}

int CreateNeuronArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'brain_index' */
    }
    offset += 2; /* brain_index */

    if( offset + 2 > data_len ) {
        return -1; /* Buffer too small for 'account_index' */
    }
    offset += 2; /* account_index */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'index' */
    }
    offset += 4; /* index */

    if( offset + 32 > data_len ) {
        return -1; /* Buffer too small for array 'seed' */
    }
    offset += 32; /* seed (array) */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'body_id' */
    }
    offset += 8; /* body_id */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'cls' */
    }
    offset += 1; /* cls */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'wedge' */
    }
    offset += 1; /* wedge */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'sign' */
    }
    offset += 1; /* sign */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'pad' */
    }
    offset += 1; /* pad */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'proof_size' */
    }
    uint64_t offset_proof_size = offset;
    offset += 4; /* proof_size */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR FlyBrainError ----- */

uint64_t FlyBrainError_footprint( void ) {
  return FlyBrainError_footprint_ir();
}

/* IR footprint generated for FlyBrainError */
uint64_t FlyBrainError_footprint_ir( void ) {
    return 8ULL;
}
/* IR validator generated for FlyBrainError */
int FlyBrainError_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 8ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

FlyBrainError_t const * FlyBrainError_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainError_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainError_t const *)data;
}

FlyBrainError_t * FlyBrainError_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainError_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainError_t *)data;
}

int FlyBrainError_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 8; /* code */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 8;

    *out_size = required_size;
    return 0; /* Success */
}

uint64_t FlyBrainError_get_code( FlyBrainError_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint64_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

void FlyBrainError_set_code( FlyBrainError_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    memcpy( &data[0], &value, sizeof( value ) );
}

int FlyBrainError_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'code' */
    }
    offset += 8; /* code */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR FlyBrainInstruction ----- */

uint64_t FlyBrainInstruction_args_inner_footprint( int64_t CreateBrain_proof_size, int64_t CreateNeuron_proof_size, int64_t instruction_type ) {
  uint64_t size = 0;
  switch ( instruction_type ) {
    case 0:
    {
      size = FlyBrainInstruction_args_CreateBrain_inner_footprint( CreateBrain_proof_size );
      break;
    }
    case 1:
    {
      size = FlyBrainInstruction_args_CreateNeuron_inner_footprint( CreateNeuron_proof_size );
      break;
    }
    case 2:
    {
      size = 52;
      break;
    }
    default:
      break;
  }
  return size;
}

uint64_t FlyBrainInstruction_footprint( int64_t args_payload_size, int64_t instruction_type ) {
  return FlyBrainInstruction_footprint_ir( (uint64_t)args_payload_size, (uint64_t)instruction_type );
}

/* IR footprint generated for FlyBrainInstruction */
uint64_t FlyBrainInstruction_footprint_ir( uint64_t args_payload_size, uint64_t args_instruction_type ) {
    return (((((((4ULL) + 4ULL - 1ULL) & ~(4ULL - 1ULL)) + (((args_payload_size) + 1ULL - 1ULL) & ~(1ULL - 1ULL)))) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
}
/* IR validator generated for FlyBrainInstruction */
int FlyBrainInstruction_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t args_payload_size, uint64_t args_instruction_type ) {
  uint64_t tn_val_0 = 4ULL;
  uint64_t tn_val_1 = tn_val_0;
  uint64_t tn_val_2 = tn_val_1 % 4ULL;
  if( tn_val_2 ) {
    uint64_t tn_val_3 = 4ULL - tn_val_2;
    if( tn_checked_add_u64( tn_val_1, tn_val_3, &tn_val_1 ) ) return 3;
  }
  uint64_t tn_val_4 = 0ULL;
  if( tn_checked_add_u64( tn_val_1, args_payload_size, &tn_val_4 ) ) return 3;
  if( tn_val_4 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_4;
  return 0;
}

FlyBrainInstruction_t const * FlyBrainInstruction_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainInstruction_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainInstruction_t const *)data;
}

FlyBrainInstruction_t * FlyBrainInstruction_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainInstruction_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainInstruction_t *)data;
}

int FlyBrainInstruction_new( uint8_t * buffer, uint64_t buffer_size, uint32_t instruction_type, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 4; /* instruction_type */
    /* Calculate enum 'args' size based on tag */
    uint64_t args_size;
    switch( (uint8_t)(instruction_type) ) {
        case 2: args_size = 52; break;
        default: return -1; /* Invalid enum tag */
    }
    required_size += args_size;


    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    memcpy( &buffer[offset], &instruction_type, sizeof( instruction_type ) );
    offset += 4;

    offset += args_size; /* skip enum 'args' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint32_t FlyBrainInstruction_get_instruction_type( FlyBrainInstruction_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return ({ uint32_t val; memcpy( &val, &data[0], sizeof( val ) ); val; });
}

/* Size helper for enum field 'args' */
uint64_t FlyBrainInstruction_get_args_size( FlyBrainInstruction_t const * self ) {
    uint8_t tag = (FlyBrainInstruction_get_instruction_type( self ));
    switch( tag ) {
        case 2: return 52;
        default: return 0;
    }
}

/* Generic body getter for enum field 'args' */
uint8_t const * FlyBrainInstruction_get_args_body( FlyBrainInstruction_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 4; /* instruction_type */
    return &data[offset];
}

/* Generic body setter for enum field 'args' */
int FlyBrainInstruction_set_args_body( FlyBrainInstruction_t * self, uint8_t const * body, uint64_t body_len ) {
    uint64_t expected_size = FlyBrainInstruction_get_args_size( (FlyBrainInstruction_t const *)self );
    if( body_len != expected_size ) {
        return -1; /* Size mismatch */
    }

    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 4; /* instruction_type */
    memcpy( &data[offset], body, body_len );
    return 0; /* Success */
}

int FlyBrainInstruction_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'instruction_type' */
    }
    offset += 4; /* instruction_type */

    uint8_t tag_args = (data[0]);
    uint64_t variant_size_args;
    switch( tag_args ) {
        case 2: variant_size_args = 52; break;
        default: return -1; /* Invalid enum tag */
    }

    if( offset + variant_size_args > data_len ) {
        return -1; /* Buffer too small for enum 'args' */
    }
    offset += variant_size_args;

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR NeuronAccountBody ----- */

uint64_t NeuronAccountBody_footprint( void ) {
  return NeuronAccountBody_footprint_ir();
}

/* IR footprint generated for NeuronAccountBody */
uint64_t NeuronAccountBody_footprint_ir( void ) {
    return 22ULL;
}
/* IR validator generated for NeuronAccountBody */
int NeuronAccountBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 22ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

NeuronAccountBody_t const * NeuronAccountBody_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( NeuronAccountBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (NeuronAccountBody_t const *)data;
}

NeuronAccountBody_t * NeuronAccountBody_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( NeuronAccountBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (NeuronAccountBody_t *)data;
}

int NeuronAccountBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 1; /* cls */
    required_size += 1; /* wedge */
    required_size += 1; /* sign */
    required_size += 3; /* pad (array) */
    required_size += 4; /* out_count */
    required_size += 4; /* in_count */
    required_size += 8; /* body_id */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 1;

    offset += 1;

    offset += 1;

    offset += 3; /* skip array 'pad' (set via setters) */

    offset += 4;

    offset += 4;

    offset += 8;

    *out_size = required_size;
    return 0; /* Success */
}

uint8_t NeuronAccountBody_get_cls( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return data[0];
}

int8_t NeuronAccountBody_get_wedge( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    return (int8_t)data[offset];
}

int8_t NeuronAccountBody_get_sign( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    return (int8_t)data[offset];
}

/* Array accessor helpers for pad */
uint64_t NeuronAccountBody_get_pad_length( NeuronAccountBody_t const * self ) {
    return 3;
}

uint8_t NeuronAccountBody_get_pad_at( NeuronAccountBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += index * 1; /* element index */
    return data[offset];
}

uint32_t NeuronAccountBody_get_out_count( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint32_t NeuronAccountBody_get_in_count( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    offset += 4; /* out_count */
    return ({ uint32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint64_t NeuronAccountBody_get_body_id( NeuronAccountBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    offset += 4; /* out_count */
    offset += 4; /* in_count */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

void NeuronAccountBody_set_cls( NeuronAccountBody_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    data[0] = value;
}

void NeuronAccountBody_set_wedge( NeuronAccountBody_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    data[offset] = value;
}

void NeuronAccountBody_set_sign( NeuronAccountBody_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    data[offset] = value;
}

void NeuronAccountBody_set_pad_at( NeuronAccountBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void NeuronAccountBody_set_out_count( NeuronAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void NeuronAccountBody_set_in_count( NeuronAccountBody_t * self, uint32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    offset += 4; /* out_count */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void NeuronAccountBody_set_body_id( NeuronAccountBody_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    offset += 4; /* out_count */
    offset += 4; /* in_count */
    memcpy( &data[offset], &value, sizeof( value ) );
}

int NeuronAccountBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'cls' */
    }
    offset += 1; /* cls */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'wedge' */
    }
    offset += 1; /* wedge */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'sign' */
    }
    offset += 1; /* sign */

    if( offset + 3 > data_len ) {
        return -1; /* Buffer too small for array 'pad' */
    }
    offset += 3; /* pad (array) */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'out_count' */
    }
    offset += 4; /* out_count */

    if( offset + 4 > data_len ) {
        return -1; /* Buffer too small for 'in_count' */
    }
    offset += 4; /* in_count */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'body_id' */
    }
    offset += 8; /* body_id */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR NeuronCreatedBody ----- */

uint64_t NeuronCreatedBody_footprint( void ) {
  return NeuronCreatedBody_footprint_ir();
}

/* IR footprint generated for NeuronCreatedBody */
uint64_t NeuronCreatedBody_footprint_ir( void ) {
    return 14ULL;
}
/* IR validator generated for NeuronCreatedBody */
int NeuronCreatedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 14ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

NeuronCreatedBody_t const * NeuronCreatedBody_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( NeuronCreatedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (NeuronCreatedBody_t const *)data;
}

NeuronCreatedBody_t * NeuronCreatedBody_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( NeuronCreatedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (NeuronCreatedBody_t *)data;
}

int NeuronCreatedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 1; /* cls */
    required_size += 1; /* wedge */
    required_size += 1; /* sign */
    required_size += 3; /* pad (array) */
    required_size += 8; /* body_id */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 1;

    offset += 1;

    offset += 1;

    offset += 3; /* skip array 'pad' (set via setters) */

    offset += 8;

    *out_size = required_size;
    return 0; /* Success */
}

uint8_t NeuronCreatedBody_get_cls( NeuronCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return data[0];
}

int8_t NeuronCreatedBody_get_wedge( NeuronCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    return (int8_t)data[offset];
}

int8_t NeuronCreatedBody_get_sign( NeuronCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    return (int8_t)data[offset];
}

/* Array accessor helpers for pad */
uint64_t NeuronCreatedBody_get_pad_length( NeuronCreatedBody_t const * self ) {
    return 3;
}

uint8_t NeuronCreatedBody_get_pad_at( NeuronCreatedBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += index * 1; /* element index */
    return data[offset];
}

uint64_t NeuronCreatedBody_get_body_id( NeuronCreatedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

void NeuronCreatedBody_set_cls( NeuronCreatedBody_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    data[0] = value;
}

void NeuronCreatedBody_set_wedge( NeuronCreatedBody_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    data[offset] = value;
}

void NeuronCreatedBody_set_sign( NeuronCreatedBody_t * self, int8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    data[offset] = value;
}

void NeuronCreatedBody_set_pad_at( NeuronCreatedBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += index * 1; /* element index */
    data[offset] = value;
}

void NeuronCreatedBody_set_body_id( NeuronCreatedBody_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* cls */
    offset += 1; /* wedge */
    offset += 1; /* sign */
    offset += 3; /* pad (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

int NeuronCreatedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'cls' */
    }
    offset += 1; /* cls */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'wedge' */
    }
    offset += 1; /* wedge */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'sign' */
    }
    offset += 1; /* sign */

    if( offset + 3 > data_len ) {
        return -1; /* Buffer too small for array 'pad' */
    }
    offset += 3; /* pad (array) */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'body_id' */
    }
    offset += 8; /* body_id */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR SynapseAddedBody ----- */

uint64_t SynapseAddedBody_footprint( void ) {
  return SynapseAddedBody_footprint_ir();
}

/* IR footprint generated for SynapseAddedBody */
uint64_t SynapseAddedBody_footprint_ir( void ) {
    return 46ULL;
}
/* IR validator generated for SynapseAddedBody */
int SynapseAddedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed ) {
  uint64_t tn_val_0 = 46ULL;
  if( tn_val_0 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_0;
  return 0;
}

SynapseAddedBody_t const * SynapseAddedBody_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( SynapseAddedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (SynapseAddedBody_t const *)data;
}

SynapseAddedBody_t * SynapseAddedBody_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( SynapseAddedBody_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (SynapseAddedBody_t *)data;
}

int SynapseAddedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 6; /* pad (array) */
    required_size += 8; /* pre_body_id */
    required_size += 8; /* post_body_id */
    required_size += 12; /* pre_xyz (array) */
    required_size += 12; /* post_xyz (array) */

    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 6; /* skip array 'pad' (set via setters) */

    offset += 8;

    offset += 8;

    offset += 12; /* skip array 'pre_xyz' (set via setters) */

    offset += 12; /* skip array 'post_xyz' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

/* Array accessor helpers for pad */
uint64_t SynapseAddedBody_get_pad_length( SynapseAddedBody_t const * self ) {
    return 6;
}

uint8_t SynapseAddedBody_get_pad_at( SynapseAddedBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = index * 1;
    return data[offset];
}

uint64_t SynapseAddedBody_get_pre_body_id( SynapseAddedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

uint64_t SynapseAddedBody_get_post_body_id( SynapseAddedBody_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    return ({ uint64_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for pre_xyz */
uint64_t SynapseAddedBody_get_pre_xyz_length( SynapseAddedBody_t const * self ) {
    return 3;
}

int32_t SynapseAddedBody_get_pre_xyz_at( SynapseAddedBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += index * 4; /* element index */
    return ({ int32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

/* Array accessor helpers for post_xyz */
uint64_t SynapseAddedBody_get_post_xyz_length( SynapseAddedBody_t const * self ) {
    return 3;
}

int32_t SynapseAddedBody_get_post_xyz_at( SynapseAddedBody_t const * self, uint64_t index ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += 12; /* pre_xyz (array) */
    offset += index * 4; /* element index */
    return ({ int32_t val; memcpy( &val, &data[offset], sizeof( val ) ); val; });
}

void SynapseAddedBody_set_pad_at( SynapseAddedBody_t * self, uint64_t index, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = index * 1;
    data[offset] = value;
}

void SynapseAddedBody_set_pre_body_id( SynapseAddedBody_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void SynapseAddedBody_set_post_body_id( SynapseAddedBody_t * self, uint64_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void SynapseAddedBody_set_pre_xyz_at( SynapseAddedBody_t * self, uint64_t index, int32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += index * 4; /* element index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

void SynapseAddedBody_set_post_xyz_at( SynapseAddedBody_t * self, uint64_t index, int32_t value ) {
    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 6; /* pad (array) */
    offset += 8; /* pre_body_id */
    offset += 8; /* post_body_id */
    offset += 12; /* pre_xyz (array) */
    offset += index * 4; /* element index */
    memcpy( &data[offset], &value, sizeof( value ) );
}

int SynapseAddedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 6 > data_len ) {
        return -1; /* Buffer too small for array 'pad' */
    }
    offset += 6; /* pad (array) */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'pre_body_id' */
    }
    offset += 8; /* pre_body_id */

    if( offset + 8 > data_len ) {
        return -1; /* Buffer too small for 'post_body_id' */
    }
    offset += 8; /* post_body_id */

    if( offset + 12 > data_len ) {
        return -1; /* Buffer too small for array 'pre_xyz' */
    }
    offset += 12; /* pre_xyz (array) */

    if( offset + 12 > data_len ) {
        return -1; /* Buffer too small for array 'post_xyz' */
    }
    offset += 12; /* post_xyz (array) */

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR FlyBrainAccount ----- */

uint64_t FlyBrainAccount_body_inner_footprint( int64_t kind ) {
  uint64_t size = 0;
  switch ( kind ) {
    case 0:
    {
      size = 82;
      break;
    }
    case 1:
    {
      size = 22;
      break;
    }
    default:
      break;
  }
  return size;
}

uint64_t FlyBrainAccount_footprint( int64_t kind ) {
  return FlyBrainAccount_footprint_ir( (uint64_t)kind, (uint64_t)kind );
}

/* IR footprint generated for FlyBrainAccount */
uint64_t FlyBrainAccount_footprint_ir( uint64_t body_kind, uint64_t FlyBrainAccount__body_kind ) {
    return ((((((((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL)) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((({ uint64_t tn_result = 0ULL; switch( FlyBrainAccount__body_kind ) {
    case 0:
        tn_result = (((82ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
        break;
    case 1:
        tn_result = (((22ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
        break;
    default:
        tn_result = 0ULL;
        break;
  }
  tn_result;
})
) + 1ULL - 1ULL) & ~(1ULL - 1ULL)))) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
}
/* IR validator generated for FlyBrainAccount */
int FlyBrainAccount_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t body_kind, uint64_t FlyBrainAccount__body_kind ) {
  uint64_t tn_val_0 = 1ULL;
  uint64_t tn_val_1 = 1ULL;
  uint64_t tn_val_2 = 0ULL;
  if( tn_checked_add_u64( tn_val_0, tn_val_1, &tn_val_2 ) ) return 3;
  uint64_t tn_val_3 = 0ULL;
  switch( FlyBrainAccount__body_kind ) {
    case 0: {
      uint64_t tn_val_4 = 82ULL;
      tn_val_3 = tn_val_4;
      break;
    }
    case 1: {
      uint64_t tn_val_5 = 22ULL;
      tn_val_3 = tn_val_5;
      break;
    }
    default: return 2;
  }
  uint64_t tn_val_6 = 0ULL;
  if( tn_checked_add_u64( tn_val_2, tn_val_3, &tn_val_6 ) ) return 3;
  if( tn_val_6 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_6;
  return 0;
}

FlyBrainAccount_t const * FlyBrainAccount_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainAccount_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainAccount_t const *)data;
}

FlyBrainAccount_t * FlyBrainAccount_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainAccount_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainAccount_t *)data;
}

int FlyBrainAccount_new( uint8_t * buffer, uint64_t buffer_size, uint8_t kind, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 1; /* version */
    required_size += 1; /* kind */
    /* Calculate enum 'body' size based on tag */
    uint64_t body_size;
    switch( (uint8_t)(kind) ) {
        case 0: body_size = 82; break;
        case 1: body_size = 22; break;
        default: return -1; /* Invalid enum tag */
    }
    required_size += body_size;


    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 1;

    buffer[offset] = kind;
    offset += 1;

    offset += body_size; /* skip enum 'body' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint8_t FlyBrainAccount_get_version( FlyBrainAccount_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return data[0];
}

uint8_t FlyBrainAccount_get_kind( FlyBrainAccount_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    return data[offset];
}

/* Size helper for enum field 'body' */
uint64_t FlyBrainAccount_get_body_size( FlyBrainAccount_t const * self ) {
    uint8_t tag = (FlyBrainAccount_get_kind( self ));
    switch( tag ) {
        case 0: return 82;
        case 1: return 22;
        default: return 0;
    }
}

/* Generic body getter for enum field 'body' */
uint8_t const * FlyBrainAccount_get_body_body( FlyBrainAccount_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    offset += 1; /* kind */
    return &data[offset];
}

/* Generic body setter for enum field 'body' */
int FlyBrainAccount_set_body_body( FlyBrainAccount_t * self, uint8_t const * body, uint64_t body_len ) {
    uint64_t expected_size = FlyBrainAccount_get_body_size( (FlyBrainAccount_t const *)self );
    if( body_len != expected_size ) {
        return -1; /* Size mismatch */
    }

    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    offset += 1; /* kind */
    memcpy( &data[offset], body, body_len );
    return 0; /* Success */
}

void FlyBrainAccount_set_version( FlyBrainAccount_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    data[0] = value;
}

int FlyBrainAccount_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'version' */
    }
    offset += 1; /* version */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'kind' */
    }
    uint64_t offset_kind = offset;
    offset += 1; /* kind */

    uint8_t tag_body = (data[offset_kind]);
    uint64_t variant_size_body;
    switch( tag_body ) {
        case 0: variant_size_body = 82; break;
        case 1: variant_size_body = 22; break;
        default: return -1; /* Invalid enum tag */
    }

    if( offset + variant_size_body > data_len ) {
        return -1; /* Buffer too small for enum 'body' */
    }
    offset += variant_size_body;

    *out_size = offset;
    return 0;
}

/*  ----- FUNCTIONS FOR FlyBrainEvent ----- */

uint64_t FlyBrainEvent_body_inner_footprint( int64_t kind ) {
  uint64_t size = 0;
  switch ( kind ) {
    case 2:
    {
      size = 40;
      break;
    }
    case 3:
    {
      size = 14;
      break;
    }
    case 4:
    {
      size = 46;
      break;
    }
    default:
      break;
  }
  return size;
}

uint64_t FlyBrainEvent_footprint( int64_t kind ) {
  return FlyBrainEvent_footprint_ir( (uint64_t)kind, (uint64_t)kind );
}

/* IR footprint generated for FlyBrainEvent */
uint64_t FlyBrainEvent_footprint_ir( uint64_t body_kind, uint64_t FlyBrainEvent__body_kind ) {
    return ((((((((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL)) + (((1ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL))) + (((({ uint64_t tn_result = 0ULL; switch( FlyBrainEvent__body_kind ) {
    case 2:
        tn_result = (((40ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
        break;
    case 3:
        tn_result = (((14ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
        break;
    case 4:
        tn_result = (((46ULL) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
        break;
    default:
        tn_result = 0ULL;
        break;
  }
  tn_result;
})
) + 1ULL - 1ULL) & ~(1ULL - 1ULL)))) + 1ULL - 1ULL) & ~(1ULL - 1ULL));
}
/* IR validator generated for FlyBrainEvent */
int FlyBrainEvent_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t body_kind, uint64_t FlyBrainEvent__body_kind ) {
  uint64_t tn_val_0 = 1ULL;
  uint64_t tn_val_1 = 1ULL;
  uint64_t tn_val_2 = 0ULL;
  if( tn_checked_add_u64( tn_val_0, tn_val_1, &tn_val_2 ) ) return 3;
  uint64_t tn_val_3 = 0ULL;
  switch( FlyBrainEvent__body_kind ) {
    case 2: {
      uint64_t tn_val_4 = 40ULL;
      tn_val_3 = tn_val_4;
      break;
    }
    case 3: {
      uint64_t tn_val_5 = 14ULL;
      tn_val_3 = tn_val_5;
      break;
    }
    case 4: {
      uint64_t tn_val_6 = 46ULL;
      tn_val_3 = tn_val_6;
      break;
    }
    default: return 2;
  }
  uint64_t tn_val_7 = 0ULL;
  if( tn_checked_add_u64( tn_val_2, tn_val_3, &tn_val_7 ) ) return 3;
  if( tn_val_7 > buf_sz ) return 1;
  if( out_bytes_consumed ) *out_bytes_consumed = tn_val_7;
  return 0;
}

FlyBrainEvent_t const * FlyBrainEvent_from_slice( uint8_t const * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainEvent_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainEvent_t const *)data;
}

FlyBrainEvent_t * FlyBrainEvent_from_slice_mut( uint8_t * data, uint64_t data_len ) {
    uint64_t required_size;
    if( FlyBrainEvent_validate( data, data_len, &required_size ) != 0 ) {
        return NULL;
    }
    return (FlyBrainEvent_t *)data;
}

int FlyBrainEvent_new( uint8_t * buffer, uint64_t buffer_size, uint8_t kind, uint64_t * out_size ) {
    uint64_t required_size = 0;
    required_size += 1; /* version */
    required_size += 1; /* kind */
    /* Calculate enum 'body' size based on tag */
    uint64_t body_size;
    switch( (uint8_t)(kind) ) {
        case 2: body_size = 40; break;
        case 3: body_size = 14; break;
        case 4: body_size = 46; break;
        default: return -1; /* Invalid enum tag */
    }
    required_size += body_size;


    if( buffer_size < required_size ) {
        return -1; /* Buffer too small */
    }

    memset( buffer, 0, required_size );

    uint64_t offset = 0;

    offset += 1;

    buffer[offset] = kind;
    offset += 1;

    offset += body_size; /* skip enum 'body' (set via setters) */

    *out_size = required_size;
    return 0; /* Success */
}

uint8_t FlyBrainEvent_get_version( FlyBrainEvent_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    return data[0];
}

uint8_t FlyBrainEvent_get_kind( FlyBrainEvent_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    return data[offset];
}

/* Size helper for enum field 'body' */
uint64_t FlyBrainEvent_get_body_size( FlyBrainEvent_t const * self ) {
    uint8_t tag = (FlyBrainEvent_get_kind( self ));
    switch( tag ) {
        case 2: return 40;
        case 3: return 14;
        case 4: return 46;
        default: return 0;
    }
}

/* Generic body getter for enum field 'body' */
uint8_t const * FlyBrainEvent_get_body_body( FlyBrainEvent_t const * self ) {
    uint8_t const * data = (uint8_t const *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    offset += 1; /* kind */
    return &data[offset];
}

/* Generic body setter for enum field 'body' */
int FlyBrainEvent_set_body_body( FlyBrainEvent_t * self, uint8_t const * body, uint64_t body_len ) {
    uint64_t expected_size = FlyBrainEvent_get_body_size( (FlyBrainEvent_t const *)self );
    if( body_len != expected_size ) {
        return -1; /* Size mismatch */
    }

    uint8_t * data = (uint8_t *)self;
    uint64_t offset = 0;
    offset += 1; /* version */
    offset += 1; /* kind */
    memcpy( &data[offset], body, body_len );
    return 0; /* Success */
}

void FlyBrainEvent_set_version( FlyBrainEvent_t * self, uint8_t value ) {
    uint8_t * data = (uint8_t *)self;
    data[0] = value;
}

int FlyBrainEvent_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {
    uint64_t offset = 0;

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'version' */
    }
    offset += 1; /* version */

    if( offset + 1 > data_len ) {
        return -1; /* Buffer too small for 'kind' */
    }
    uint64_t offset_kind = offset;
    offset += 1; /* kind */

    uint8_t tag_body = (data[offset_kind]);
    uint64_t variant_size_body;
    switch( tag_body ) {
        case 2: variant_size_body = 40; break;
        case 3: variant_size_body = 14; break;
        case 4: variant_size_body = 46; break;
        default: return -1; /* Invalid enum tag */
    }

    if( offset + variant_size_body > data_len ) {
        return -1; /* Buffer too small for enum 'body' */
    }
    offset += variant_size_body;

    *out_size = offset;
    return 0;
}

