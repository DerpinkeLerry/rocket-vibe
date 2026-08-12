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
	stateHeaderBytes = 17
	StateBytes       = stateHeaderBytes + entityFloatCount*entityCount*4
)

type InputPacket struct {
	Sequence uint32
	Mask     uint8
	Edges    uint8
	Flags    uint8
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
		packet.Flags = data[7] & 0x01
	}
	return packet, true
}

func EncodeState(snapshot game.Snapshot) []byte {
	buffer := make([]byte, StateBytes)
	buffer[0] = MessageState
	binary.LittleEndian.PutUint32(buffer[1:5], uint32(snapshot.Tick))
	buffer[5] = snapshot.ConnectedMask
	buffer[6] = snapshot.GroundMask
	binary.LittleEndian.PutUint16(buffer[7:9], snapshot.OrangeScore)
	binary.LittleEndian.PutUint16(buffer[9:11], snapshot.BlueScore)
	for index := range snapshot.Boost {
		buffer[11+index] = snapshot.Boost[index]
	}
	binary.LittleEndian.PutUint16(buffer[15:17], snapshot.BoostPadMask)

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
