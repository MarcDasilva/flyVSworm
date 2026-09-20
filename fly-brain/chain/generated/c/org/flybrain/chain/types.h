#pragma once

#include <stdint.h>
#include <stddef.h>

/*  ----- TYPE DEFINITION FOR AddSynapseArgs ----- */

struct __attribute__((packed)) AddSynapseArgs {
    uint16_t brain_index;
    uint16_t pre_index;
    uint16_t post_index;
    uint16_t pad;
    uint32_t index;
    uint64_t pre_body_id;
    uint64_t post_body_id;
    int32_t pre_xyz[3];
    int32_t post_xyz[3];
};
typedef struct AddSynapseArgs AddSynapseArgs_t;

/*  ----- TYPE DEFINITION FOR BrainAccountBody ----- */

struct __attribute__((packed)) BrainAccountBody {
    uint8_t pad[2];
    uint32_t neuron_count;
    uint32_t synapse_count;
    uint32_t neuron_total;
    uint32_t synapse_total;
    uint8_t manifest_sha256[32];
    uint8_t authority[32];
};
typedef struct BrainAccountBody BrainAccountBody_t;

/*  ----- TYPE DEFINITION FOR BrainCreatedBody ----- */

struct __attribute__((packed)) BrainCreatedBody {
    uint32_t neuron_total;
    uint32_t synapse_total;
    uint8_t manifest_sha256[32];
};
typedef struct BrainCreatedBody BrainCreatedBody_t;

/*  ----- TYPE DEFINITION FOR CreateBrainArgs ----- */

struct __attribute__((packed)) CreateBrainArgs {
    uint16_t account_index;
    uint8_t seed[32];
    uint8_t manifest_sha256[32];
    uint8_t authority[32];
    uint32_t neuron_total;
    uint32_t synapse_total;
    uint32_t proof_size;
    uint8_t proof[] /* FAM size: proof_size */;
};
typedef struct CreateBrainArgs CreateBrainArgs_t;

/*  ----- TYPE DEFINITION FOR CreateNeuronArgs ----- */

struct __attribute__((packed)) CreateNeuronArgs {
    uint16_t brain_index;
    uint16_t account_index;
    uint32_t index;
    uint8_t seed[32];
    uint64_t body_id;
    uint8_t cls;
    int8_t wedge;
    int8_t sign;
    uint8_t pad;
    uint32_t proof_size;
    uint8_t proof[] /* FAM size: proof_size */;
};
typedef struct CreateNeuronArgs CreateNeuronArgs_t;

/*  ----- TYPE DEFINITION FOR FlyBrainError ----- */

struct __attribute__((packed)) FlyBrainError {
    uint64_t code;
};
typedef struct FlyBrainError FlyBrainError_t;

/*  ----- TYPE DEFINITION FOR FlyBrainInstruction ----- */

struct __attribute__((packed)) FlyBrainInstruction_args_inner {
    uint8_t tag;
    uint8_t body[]; /* enum body inline (access via getters) */
};
typedef struct FlyBrainInstruction_args_inner FlyBrainInstruction_args_inner_t;

struct __attribute__((packed)) FlyBrainInstruction {
    uint32_t instruction_type;
    /* args - enum body inline (access via getters) */
};
typedef struct FlyBrainInstruction FlyBrainInstruction_t;

/*  ----- TYPE DEFINITION FOR NeuronAccountBody ----- */

struct __attribute__((packed)) NeuronAccountBody {
    uint8_t cls;
    int8_t wedge;
    int8_t sign;
    uint8_t pad[3];
    uint32_t out_count;
    uint32_t in_count;
    uint64_t body_id;
};
typedef struct NeuronAccountBody NeuronAccountBody_t;

/*  ----- TYPE DEFINITION FOR NeuronCreatedBody ----- */

struct __attribute__((packed)) NeuronCreatedBody {
    uint8_t cls;
    int8_t wedge;
    int8_t sign;
    uint8_t pad[3];
    uint64_t body_id;
};
typedef struct NeuronCreatedBody NeuronCreatedBody_t;

/*  ----- TYPE DEFINITION FOR SynapseAddedBody ----- */

struct __attribute__((packed)) SynapseAddedBody {
    uint8_t pad[6];
    uint64_t pre_body_id;
    uint64_t post_body_id;
    int32_t pre_xyz[3];
    int32_t post_xyz[3];
};
typedef struct SynapseAddedBody SynapseAddedBody_t;

/*  ----- TYPE DEFINITION FOR FlyBrainAccount ----- */

struct __attribute__((packed)) FlyBrainAccount_body_inner {
    uint8_t tag;
    uint8_t body[]; /* enum body inline (access via getters) */
};
typedef struct FlyBrainAccount_body_inner FlyBrainAccount_body_inner_t;

struct __attribute__((packed)) FlyBrainAccount {
    uint8_t version;
    uint8_t kind;
    /* body - enum body inline (access via getters) */
};
typedef struct FlyBrainAccount FlyBrainAccount_t;

/*  ----- TYPE DEFINITION FOR FlyBrainEvent ----- */

struct __attribute__((packed)) FlyBrainEvent_body_inner {
    uint8_t tag;
    uint8_t body[]; /* enum body inline (access via getters) */
};
typedef struct FlyBrainEvent_body_inner FlyBrainEvent_body_inner_t;

struct __attribute__((packed)) FlyBrainEvent {
    uint8_t version;
    uint8_t kind;
    /* body - enum body inline (access via getters) */
};
typedef struct FlyBrainEvent FlyBrainEvent_t;


/*  ----- FORWARD DECLARATIONS FOR AddSynapseArgs ----- */

AddSynapseArgs_t const * AddSynapseArgs_from_slice( uint8_t const * data, uint64_t data_len );
AddSynapseArgs_t * AddSynapseArgs_from_slice_mut( uint8_t * data, uint64_t data_len );
int AddSynapseArgs_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t AddSynapseArgs_footprint( void );
uint64_t AddSynapseArgs_footprint_ir( void );
int AddSynapseArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int AddSynapseArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint16_t AddSynapseArgs_get_brain_index( AddSynapseArgs_t const * self );
uint16_t AddSynapseArgs_get_pre_index( AddSynapseArgs_t const * self );
uint16_t AddSynapseArgs_get_post_index( AddSynapseArgs_t const * self );
uint16_t AddSynapseArgs_get_pad( AddSynapseArgs_t const * self );
uint32_t AddSynapseArgs_get_index( AddSynapseArgs_t const * self );
uint64_t AddSynapseArgs_get_pre_body_id( AddSynapseArgs_t const * self );
uint64_t AddSynapseArgs_get_post_body_id( AddSynapseArgs_t const * self );

void AddSynapseArgs_set_brain_index( AddSynapseArgs_t * self, uint16_t value );
void AddSynapseArgs_set_pre_index( AddSynapseArgs_t * self, uint16_t value );
void AddSynapseArgs_set_post_index( AddSynapseArgs_t * self, uint16_t value );
void AddSynapseArgs_set_pad( AddSynapseArgs_t * self, uint16_t value );
void AddSynapseArgs_set_index( AddSynapseArgs_t * self, uint32_t value );
void AddSynapseArgs_set_pre_body_id( AddSynapseArgs_t * self, uint64_t value );
void AddSynapseArgs_set_post_body_id( AddSynapseArgs_t * self, uint64_t value );

uint64_t AddSynapseArgs_get_pre_xyz_length( AddSynapseArgs_t const * self );
int32_t AddSynapseArgs_get_pre_xyz_at( AddSynapseArgs_t const * self, uint64_t index );
void AddSynapseArgs_set_pre_xyz_at( AddSynapseArgs_t * self, uint64_t index, int32_t value );
uint64_t AddSynapseArgs_get_post_xyz_length( AddSynapseArgs_t const * self );
int32_t AddSynapseArgs_get_post_xyz_at( AddSynapseArgs_t const * self, uint64_t index );
void AddSynapseArgs_set_post_xyz_at( AddSynapseArgs_t * self, uint64_t index, int32_t value );



/*  ----- FORWARD DECLARATIONS FOR BrainAccountBody ----- */

BrainAccountBody_t const * BrainAccountBody_from_slice( uint8_t const * data, uint64_t data_len );
BrainAccountBody_t * BrainAccountBody_from_slice_mut( uint8_t * data, uint64_t data_len );
int BrainAccountBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t BrainAccountBody_footprint( void );
uint64_t BrainAccountBody_footprint_ir( void );
int BrainAccountBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int BrainAccountBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint32_t BrainAccountBody_get_neuron_count( BrainAccountBody_t const * self );
uint32_t BrainAccountBody_get_synapse_count( BrainAccountBody_t const * self );
uint32_t BrainAccountBody_get_neuron_total( BrainAccountBody_t const * self );
uint32_t BrainAccountBody_get_synapse_total( BrainAccountBody_t const * self );

void BrainAccountBody_set_neuron_count( BrainAccountBody_t * self, uint32_t value );
void BrainAccountBody_set_synapse_count( BrainAccountBody_t * self, uint32_t value );
void BrainAccountBody_set_neuron_total( BrainAccountBody_t * self, uint32_t value );
void BrainAccountBody_set_synapse_total( BrainAccountBody_t * self, uint32_t value );

uint64_t BrainAccountBody_get_pad_length( BrainAccountBody_t const * self );
uint8_t BrainAccountBody_get_pad_at( BrainAccountBody_t const * self, uint64_t index );
void BrainAccountBody_set_pad_at( BrainAccountBody_t * self, uint64_t index, uint8_t value );
uint64_t BrainAccountBody_get_manifest_sha256_length( BrainAccountBody_t const * self );
uint8_t BrainAccountBody_get_manifest_sha256_at( BrainAccountBody_t const * self, uint64_t index );
void BrainAccountBody_set_manifest_sha256_at( BrainAccountBody_t * self, uint64_t index, uint8_t value );
uint64_t BrainAccountBody_get_authority_length( BrainAccountBody_t const * self );
uint8_t BrainAccountBody_get_authority_at( BrainAccountBody_t const * self, uint64_t index );
void BrainAccountBody_set_authority_at( BrainAccountBody_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR BrainCreatedBody ----- */

BrainCreatedBody_t const * BrainCreatedBody_from_slice( uint8_t const * data, uint64_t data_len );
BrainCreatedBody_t * BrainCreatedBody_from_slice_mut( uint8_t * data, uint64_t data_len );
int BrainCreatedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t BrainCreatedBody_footprint( void );
uint64_t BrainCreatedBody_footprint_ir( void );
int BrainCreatedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int BrainCreatedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint32_t BrainCreatedBody_get_neuron_total( BrainCreatedBody_t const * self );
uint32_t BrainCreatedBody_get_synapse_total( BrainCreatedBody_t const * self );

void BrainCreatedBody_set_neuron_total( BrainCreatedBody_t * self, uint32_t value );
void BrainCreatedBody_set_synapse_total( BrainCreatedBody_t * self, uint32_t value );

uint64_t BrainCreatedBody_get_manifest_sha256_length( BrainCreatedBody_t const * self );
uint8_t BrainCreatedBody_get_manifest_sha256_at( BrainCreatedBody_t const * self, uint64_t index );
void BrainCreatedBody_set_manifest_sha256_at( BrainCreatedBody_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR CreateBrainArgs ----- */

CreateBrainArgs_t const * CreateBrainArgs_from_slice( uint8_t const * data, uint64_t data_len );
CreateBrainArgs_t * CreateBrainArgs_from_slice_mut( uint8_t * data, uint64_t data_len );
int CreateBrainArgs_new( uint8_t * buffer, uint64_t buffer_size, uint32_t proof_size, uint64_t * out_size );
uint64_t CreateBrainArgs_footprint( int64_t proof_size );
uint64_t CreateBrainArgs_footprint_ir( uint64_t proof_proof_size );
int CreateBrainArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t proof_proof_size );
int CreateBrainArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint16_t CreateBrainArgs_get_account_index( CreateBrainArgs_t const * self );
uint32_t CreateBrainArgs_get_neuron_total( CreateBrainArgs_t const * self );
uint32_t CreateBrainArgs_get_synapse_total( CreateBrainArgs_t const * self );
uint32_t CreateBrainArgs_get_proof_size( CreateBrainArgs_t const * self );

void CreateBrainArgs_set_account_index( CreateBrainArgs_t * self, uint16_t value );
void CreateBrainArgs_set_neuron_total( CreateBrainArgs_t * self, uint32_t value );
void CreateBrainArgs_set_synapse_total( CreateBrainArgs_t * self, uint32_t value );

uint64_t CreateBrainArgs_get_seed_length( CreateBrainArgs_t const * self );
uint8_t CreateBrainArgs_get_seed_at( CreateBrainArgs_t const * self, uint64_t index );
void CreateBrainArgs_set_seed_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value );
uint64_t CreateBrainArgs_get_manifest_sha256_length( CreateBrainArgs_t const * self );
uint8_t CreateBrainArgs_get_manifest_sha256_at( CreateBrainArgs_t const * self, uint64_t index );
void CreateBrainArgs_set_manifest_sha256_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value );
uint64_t CreateBrainArgs_get_authority_length( CreateBrainArgs_t const * self );
uint8_t CreateBrainArgs_get_authority_at( CreateBrainArgs_t const * self, uint64_t index );
void CreateBrainArgs_set_authority_at( CreateBrainArgs_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR CreateNeuronArgs ----- */

CreateNeuronArgs_t const * CreateNeuronArgs_from_slice( uint8_t const * data, uint64_t data_len );
CreateNeuronArgs_t * CreateNeuronArgs_from_slice_mut( uint8_t * data, uint64_t data_len );
int CreateNeuronArgs_new( uint8_t * buffer, uint64_t buffer_size, uint32_t proof_size, uint64_t * out_size );
uint64_t CreateNeuronArgs_footprint( int64_t proof_size );
uint64_t CreateNeuronArgs_footprint_ir( uint64_t proof_proof_size );
int CreateNeuronArgs_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t proof_proof_size );
int CreateNeuronArgs_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint16_t CreateNeuronArgs_get_brain_index( CreateNeuronArgs_t const * self );
uint16_t CreateNeuronArgs_get_account_index( CreateNeuronArgs_t const * self );
uint32_t CreateNeuronArgs_get_index( CreateNeuronArgs_t const * self );
uint64_t CreateNeuronArgs_get_body_id( CreateNeuronArgs_t const * self );
uint8_t CreateNeuronArgs_get_cls( CreateNeuronArgs_t const * self );
int8_t CreateNeuronArgs_get_wedge( CreateNeuronArgs_t const * self );
int8_t CreateNeuronArgs_get_sign( CreateNeuronArgs_t const * self );
uint8_t CreateNeuronArgs_get_pad( CreateNeuronArgs_t const * self );
uint32_t CreateNeuronArgs_get_proof_size( CreateNeuronArgs_t const * self );

void CreateNeuronArgs_set_brain_index( CreateNeuronArgs_t * self, uint16_t value );
void CreateNeuronArgs_set_account_index( CreateNeuronArgs_t * self, uint16_t value );
void CreateNeuronArgs_set_index( CreateNeuronArgs_t * self, uint32_t value );
void CreateNeuronArgs_set_body_id( CreateNeuronArgs_t * self, uint64_t value );
void CreateNeuronArgs_set_cls( CreateNeuronArgs_t * self, uint8_t value );
void CreateNeuronArgs_set_wedge( CreateNeuronArgs_t * self, int8_t value );
void CreateNeuronArgs_set_sign( CreateNeuronArgs_t * self, int8_t value );
void CreateNeuronArgs_set_pad( CreateNeuronArgs_t * self, uint8_t value );

uint64_t CreateNeuronArgs_get_seed_length( CreateNeuronArgs_t const * self );
uint8_t CreateNeuronArgs_get_seed_at( CreateNeuronArgs_t const * self, uint64_t index );
void CreateNeuronArgs_set_seed_at( CreateNeuronArgs_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR FlyBrainError ----- */

FlyBrainError_t const * FlyBrainError_from_slice( uint8_t const * data, uint64_t data_len );
FlyBrainError_t * FlyBrainError_from_slice_mut( uint8_t * data, uint64_t data_len );
int FlyBrainError_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t FlyBrainError_footprint( void );
uint64_t FlyBrainError_footprint_ir( void );
int FlyBrainError_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int FlyBrainError_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint64_t FlyBrainError_get_code( FlyBrainError_t const * self );

void FlyBrainError_set_code( FlyBrainError_t * self, uint64_t value );




/*  ----- FORWARD DECLARATIONS FOR FlyBrainInstruction ----- */

FlyBrainInstruction_t const * FlyBrainInstruction_from_slice( uint8_t const * data, uint64_t data_len );
FlyBrainInstruction_t * FlyBrainInstruction_from_slice_mut( uint8_t * data, uint64_t data_len );
int FlyBrainInstruction_new( uint8_t * buffer, uint64_t buffer_size, uint32_t instruction_type, uint64_t * out_size );
uint64_t FlyBrainInstruction_footprint( int64_t args_payload_size, int64_t instruction_type );
uint64_t FlyBrainInstruction_footprint_ir( uint64_t args_payload_size, uint64_t args_instruction_type );
int FlyBrainInstruction_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t args_payload_size, uint64_t args_instruction_type );
int FlyBrainInstruction_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint32_t FlyBrainInstruction_get_instruction_type( FlyBrainInstruction_t const * self );

uint64_t FlyBrainInstruction_get_args_size( FlyBrainInstruction_t const * self );

uint8_t const * FlyBrainInstruction_get_args_body( FlyBrainInstruction_t const * self );
int FlyBrainInstruction_set_args_body( FlyBrainInstruction_t * self, uint8_t const * body, uint64_t body_len );





/*  ----- FORWARD DECLARATIONS FOR NeuronAccountBody ----- */

NeuronAccountBody_t const * NeuronAccountBody_from_slice( uint8_t const * data, uint64_t data_len );
NeuronAccountBody_t * NeuronAccountBody_from_slice_mut( uint8_t * data, uint64_t data_len );
int NeuronAccountBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t NeuronAccountBody_footprint( void );
uint64_t NeuronAccountBody_footprint_ir( void );
int NeuronAccountBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int NeuronAccountBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint8_t NeuronAccountBody_get_cls( NeuronAccountBody_t const * self );
int8_t NeuronAccountBody_get_wedge( NeuronAccountBody_t const * self );
int8_t NeuronAccountBody_get_sign( NeuronAccountBody_t const * self );
uint32_t NeuronAccountBody_get_out_count( NeuronAccountBody_t const * self );
uint32_t NeuronAccountBody_get_in_count( NeuronAccountBody_t const * self );
uint64_t NeuronAccountBody_get_body_id( NeuronAccountBody_t const * self );

void NeuronAccountBody_set_cls( NeuronAccountBody_t * self, uint8_t value );
void NeuronAccountBody_set_wedge( NeuronAccountBody_t * self, int8_t value );
void NeuronAccountBody_set_sign( NeuronAccountBody_t * self, int8_t value );
void NeuronAccountBody_set_out_count( NeuronAccountBody_t * self, uint32_t value );
void NeuronAccountBody_set_in_count( NeuronAccountBody_t * self, uint32_t value );
void NeuronAccountBody_set_body_id( NeuronAccountBody_t * self, uint64_t value );

uint64_t NeuronAccountBody_get_pad_length( NeuronAccountBody_t const * self );
uint8_t NeuronAccountBody_get_pad_at( NeuronAccountBody_t const * self, uint64_t index );
void NeuronAccountBody_set_pad_at( NeuronAccountBody_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR NeuronCreatedBody ----- */

NeuronCreatedBody_t const * NeuronCreatedBody_from_slice( uint8_t const * data, uint64_t data_len );
NeuronCreatedBody_t * NeuronCreatedBody_from_slice_mut( uint8_t * data, uint64_t data_len );
int NeuronCreatedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t NeuronCreatedBody_footprint( void );
uint64_t NeuronCreatedBody_footprint_ir( void );
int NeuronCreatedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int NeuronCreatedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint8_t NeuronCreatedBody_get_cls( NeuronCreatedBody_t const * self );
int8_t NeuronCreatedBody_get_wedge( NeuronCreatedBody_t const * self );
int8_t NeuronCreatedBody_get_sign( NeuronCreatedBody_t const * self );
uint64_t NeuronCreatedBody_get_body_id( NeuronCreatedBody_t const * self );

void NeuronCreatedBody_set_cls( NeuronCreatedBody_t * self, uint8_t value );
void NeuronCreatedBody_set_wedge( NeuronCreatedBody_t * self, int8_t value );
void NeuronCreatedBody_set_sign( NeuronCreatedBody_t * self, int8_t value );
void NeuronCreatedBody_set_body_id( NeuronCreatedBody_t * self, uint64_t value );

uint64_t NeuronCreatedBody_get_pad_length( NeuronCreatedBody_t const * self );
uint8_t NeuronCreatedBody_get_pad_at( NeuronCreatedBody_t const * self, uint64_t index );
void NeuronCreatedBody_set_pad_at( NeuronCreatedBody_t * self, uint64_t index, uint8_t value );



/*  ----- FORWARD DECLARATIONS FOR SynapseAddedBody ----- */

SynapseAddedBody_t const * SynapseAddedBody_from_slice( uint8_t const * data, uint64_t data_len );
SynapseAddedBody_t * SynapseAddedBody_from_slice_mut( uint8_t * data, uint64_t data_len );
int SynapseAddedBody_new( uint8_t * buffer, uint64_t buffer_size, uint64_t * out_size );
uint64_t SynapseAddedBody_footprint( void );
uint64_t SynapseAddedBody_footprint_ir( void );
int SynapseAddedBody_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed );
int SynapseAddedBody_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint64_t SynapseAddedBody_get_pre_body_id( SynapseAddedBody_t const * self );
uint64_t SynapseAddedBody_get_post_body_id( SynapseAddedBody_t const * self );

void SynapseAddedBody_set_pre_body_id( SynapseAddedBody_t * self, uint64_t value );
void SynapseAddedBody_set_post_body_id( SynapseAddedBody_t * self, uint64_t value );

uint64_t SynapseAddedBody_get_pad_length( SynapseAddedBody_t const * self );
uint8_t SynapseAddedBody_get_pad_at( SynapseAddedBody_t const * self, uint64_t index );
void SynapseAddedBody_set_pad_at( SynapseAddedBody_t * self, uint64_t index, uint8_t value );
uint64_t SynapseAddedBody_get_pre_xyz_length( SynapseAddedBody_t const * self );
int32_t SynapseAddedBody_get_pre_xyz_at( SynapseAddedBody_t const * self, uint64_t index );
void SynapseAddedBody_set_pre_xyz_at( SynapseAddedBody_t * self, uint64_t index, int32_t value );
uint64_t SynapseAddedBody_get_post_xyz_length( SynapseAddedBody_t const * self );
int32_t SynapseAddedBody_get_post_xyz_at( SynapseAddedBody_t const * self, uint64_t index );
void SynapseAddedBody_set_post_xyz_at( SynapseAddedBody_t * self, uint64_t index, int32_t value );



/*  ----- FORWARD DECLARATIONS FOR FlyBrainAccount ----- */

FlyBrainAccount_t const * FlyBrainAccount_from_slice( uint8_t const * data, uint64_t data_len );
FlyBrainAccount_t * FlyBrainAccount_from_slice_mut( uint8_t * data, uint64_t data_len );
int FlyBrainAccount_new( uint8_t * buffer, uint64_t buffer_size, uint8_t kind, uint64_t * out_size );
uint64_t FlyBrainAccount_footprint( int64_t kind );
uint64_t FlyBrainAccount_footprint_ir( uint64_t body_kind, uint64_t FlyBrainAccount__body_kind );
int FlyBrainAccount_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t body_kind, uint64_t FlyBrainAccount__body_kind );
int FlyBrainAccount_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint8_t FlyBrainAccount_get_version( FlyBrainAccount_t const * self );
uint8_t FlyBrainAccount_get_kind( FlyBrainAccount_t const * self );

uint64_t FlyBrainAccount_get_body_size( FlyBrainAccount_t const * self );

uint8_t const * FlyBrainAccount_get_body_body( FlyBrainAccount_t const * self );
int FlyBrainAccount_set_body_body( FlyBrainAccount_t * self, uint8_t const * body, uint64_t body_len );

void FlyBrainAccount_set_version( FlyBrainAccount_t * self, uint8_t value );




/*  ----- FORWARD DECLARATIONS FOR FlyBrainEvent ----- */

FlyBrainEvent_t const * FlyBrainEvent_from_slice( uint8_t const * data, uint64_t data_len );
FlyBrainEvent_t * FlyBrainEvent_from_slice_mut( uint8_t * data, uint64_t data_len );
int FlyBrainEvent_new( uint8_t * buffer, uint64_t buffer_size, uint8_t kind, uint64_t * out_size );
uint64_t FlyBrainEvent_footprint( int64_t kind );
uint64_t FlyBrainEvent_footprint_ir( uint64_t body_kind, uint64_t FlyBrainEvent__body_kind );
int FlyBrainEvent_validate_ir( uint64_t buf_sz, uint64_t * out_bytes_consumed, uint64_t body_kind, uint64_t FlyBrainEvent__body_kind );
int FlyBrainEvent_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );
uint8_t FlyBrainEvent_get_version( FlyBrainEvent_t const * self );
uint8_t FlyBrainEvent_get_kind( FlyBrainEvent_t const * self );

uint64_t FlyBrainEvent_get_body_size( FlyBrainEvent_t const * self );

uint8_t const * FlyBrainEvent_get_body_body( FlyBrainEvent_t const * self );
int FlyBrainEvent_set_body_body( FlyBrainEvent_t * self, uint8_t const * body, uint64_t body_len );

void FlyBrainEvent_set_version( FlyBrainEvent_t * self, uint8_t value );



