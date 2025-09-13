import { IsEnum, IsNotEmpty, IsNumber, IsString } from "class-validator";
import { SUPPORTED_MODELS } from "../constants/models.constant";

export class SimpleChatAgentInput {
    @IsNumber()
    @IsNotEmpty()
    conversationId: number;

    @IsString()
    @IsNotEmpty()
    message: string;

    @IsEnum(SUPPORTED_MODELS)
    @IsNotEmpty()
    model: SUPPORTED_MODELS;
}