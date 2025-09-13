import { IsNotEmpty, IsNumber } from "class-validator";

export class CreateConversationOutput {
    @IsNumber()
    @IsNotEmpty()
    conversationId: number;
}