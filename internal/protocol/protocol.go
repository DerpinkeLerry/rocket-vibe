package protocol

import (
	"encoding/binary"
	"math"

	"rocket-vibe/internal/game"
)

const (
	MessageInput byte = 1
	MessageState byte = 2

	entityFloatCount = 13
	entityCount      = game.MaxPlayers + 1
	stateHeaderBytes = 23
	StateBytes       = stateHeaderBytes + entityFloatCount*entityCount*4
)

type InputPacket struct {
	Sequence uint32
	Mask     uint8
	Edges    uint8
	Flags    uint8
	Throttle float64
	Steer    float64
}

func DecodeInput(data []byte) (InputPacket, bool) {
	if len(data) < 7 || data[0] != MessageInput {
		return InputPacket{}, false
	}
	packet := InputPacket{
		Sequence: binary.LittleEndian.Uint32(data[1:5]),
		Mask:     data[5] & 0xff,
		Edges:    data[6] & 0x07,
	}
	if len(data) >= 8 {
		packet.Flags = data[7] & (game.InputFlagDrift | game.InputFlagAnalog)
	}
	// v1.10.15 analog extension. Signed bytes preserve enough precision for a
	// phone thumbstick while keeping held-input traffic tiny. Legacy 7/8-byte
	// packets simply remain digital.
	if len(data) >= 10 && packet.Flags&game.InputFlagAnalog != 0 {
		packet.Throttle = decodeAxis(data[8])
		packet.Steer = decodeAxis(data[9])
	}
	return packet, true
}

func decodeAxis(value byte) float64 {
	signed := int8(value)
	axis := float64(signed) / 127.0
	if axis < -1 {
		return -1
	}
	if axis > 1 {
		return 1
	}
	return axis
}

func EncodeState(snapshot game.Snapshot) []byte {
	buffer := make([]byte, StateBytes)
	buffer[0] = MessageState
	binary.LittleEndian.PutUint32(buffer[1:5], uint32(snapshot.Tick))
	buffer[5] = snapshot.ConnectedMask
	// Lower nibble remains the legacy grounded mask. Upper nibble carries the
	// four demolition flags without growing the packet, so older clients keep
	// parsing entity floats at the exact same offsets.
	buffer[6] = (snapshot.GroundMask & 0x0f) | ((snapshot.DemolishedMask & 0x0f) << 4)
	binary.LittleEndian.PutUint16(buffer[7:9], snapshot.OrangeScore)
	binary.LittleEndian.PutUint16(buffer[9:11], snapshot.BlueScore)
	for index := range snapshot.Boost {
		buffer[11+index] = snapshot.Boost[index]
	}
	binary.LittleEndian.PutUint64(buffer[15:23], snapshot.BoostPadMask)

	offset := stateHeaderBytes
	for index := range snapshot.Cars {
		offset = writeEntity(buffer, offset, snapshot.Cars[index])
	}
	writeEntity(buffer, offset, snapshot.Ball)
	return buffer
}

func writeEntity(buffer []byte, offset int, entity game.EntityState) int {
	values := [...]float64{
		entity.Position.X, entity.Position.Y, entity.Position.Z,
		entity.Rotation.X, entity.Rotation.Y, entity.Rotation.Z, entity.Rotation.W,
		entity.Velocity.X, entity.Velocity.Y, entity.Velocity.Z,
		entity.AngularVelocity.X, entity.AngularVelocity.Y, entity.AngularVelocity.Z,
	}
	for _, value := range values {
		binary.LittleEndian.PutUint32(buffer[offset:offset+4], math.Float32bits(float32(value)))
		offset += 4
	}
	return offset
}
