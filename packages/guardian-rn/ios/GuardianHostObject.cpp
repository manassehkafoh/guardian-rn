#include "GuardianHostObject.h"
#include <sstream>
#include <random>
#include <iomanip>

namespace guardian {

GuardianHostObject::GuardianHostObject(
    std::vector<uint8_t> sessionKey,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
    : sessionKey_(std::move(sessionKey))
    , callInvoker_(std::move(callInvoker)) {}

Value GuardianHostObject::get(Runtime& rt, const PropNameID& name) {
    const std::string n = name.utf8(rt);

    if (n == "getSessionKey") {
        return Function::createFromHostFunction(
            rt, PropNameID::forAscii(rt, "getSessionKey"), 0,
            [this](Runtime& rt, const Value&, const Value*, size_t) -> Value {
                return getSessionKeyImpl(rt);
            });
    }

    if (n == "subscribe") {
        return Function::createFromHostFunction(
            rt, PropNameID::forAscii(rt, "subscribe"), 2,
            [this](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
                return subscribeImpl(rt, args, count);
            });
    }

    if (n == "unsubscribe") {
        return Function::createFromHostFunction(
            rt, PropNameID::forAscii(rt, "unsubscribe"), 1,
            [this](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
                return unsubscribeImpl(rt, args, count);
            });
    }

    return Value::undefined();
}

void GuardianHostObject::set(Runtime&, const PropNameID&, const Value&) {
    // HostObject properties are read-only
}

std::vector<PropNameID> GuardianHostObject::getPropertyNames(Runtime& rt) {
    return {
        PropNameID::forAscii(rt, "getSessionKey"),
        PropNameID::forAscii(rt, "subscribe"),
        PropNameID::forAscii(rt, "unsubscribe"),
    };
}

Value GuardianHostObject::getSessionKeyImpl(Runtime& rt) {
    // One-call-only enforcement per ADR-0003
    bool expected = false;
    if (!keyDelivered_.compare_exchange_strong(expected, true)) {
        throw JSError(rt, "GuardianError: session key already delivered — may only be called once per session");
    }

    // Copy key bytes into a JS ArrayBuffer
    auto buf = ArrayBuffer(rt, sessionKey_.size());
    auto* data = buf.data(rt);
    std::memcpy(data, sessionKey_.data(), sessionKey_.size());

    // Zero out the native copy after delivery
    std::fill(sessionKey_.begin(), sessionKey_.end(), 0);

    return Value(rt, buf);
}

Value GuardianHostObject::subscribeImpl(Runtime& rt, const Value* args, size_t count) {
    if (count < 2 || !args[1].isObject() || !args[1].asObject(rt).isFunction(rt)) {
        throw JSError(rt, "GuardianError: subscribe(filter, fn) — second argument must be a function");
    }

    const std::string id = generateSubscriberId();
    auto fn = std::make_shared<Function>(args[1].asObject(rt).asFunction(rt));

    {
        std::lock_guard<std::mutex> lock(subscriberMutex_);
        subscribers_[id] = [fn, &rt](const std::string& json) {
            // Callback is dispatched on the JS thread via CallInvoker
            fn->call(rt, String::createFromUtf8(rt, json));
        };
    }

    return String::createFromUtf8(rt, id);
}

Value GuardianHostObject::unsubscribeImpl(Runtime& rt, const Value* args, size_t count) {
    if (count < 1 || !args[0].isString()) {
        throw JSError(rt, "GuardianError: unsubscribe(subscriberId) — argument must be a string");
    }

    const std::string id = args[0].asString(rt).utf8(rt);
    std::lock_guard<std::mutex> lock(subscriberMutex_);
    subscribers_.erase(id);

    return Value::undefined();
}

void GuardianHostObject::emitEnvelope(const std::string& envelopeJson) {
    // Copy the subscriber snapshot under the lock, then dispatch outside it
    std::unordered_map<std::string, EventCallback> snapshot;
    {
        std::lock_guard<std::mutex> lock(subscriberMutex_);
        snapshot = subscribers_;
    }

    if (snapshot.empty()) return;

    callInvoker_->invokeAsync([snapshot = std::move(snapshot), envelopeJson]() {
        for (const auto& [id, cb] : snapshot) {
            cb(envelopeJson);
        }
    });
}

std::string GuardianHostObject::generateSubscriberId() {
    std::random_device rd;
    std::mt19937_64 gen(rd());
    std::uniform_int_distribution<uint64_t> dist;
    std::ostringstream oss;
    oss << "sub_" << std::hex << std::setfill('0')
        << std::setw(16) << dist(gen)
        << std::setw(16) << dist(gen);
    return oss.str();
}

} // namespace guardian
